# Campus Customs HW4 Harness

This document describes the implementation currently in `hw4/`. It records actual behavior and configured limits; it does not describe planned features.

## Data pack and database

The local-only data pack is expected at the project-root `hw4/data/`, with `campus_customs.db` and `products/`. The application reads the database and product images from there. `.gitignore` excludes the entire `data/` directory. Catalogue and inventory lookups use SQLite read-only connections; signup and authenticated chat-history persistence use write connections.

The inspected SQLite schema has these tables and relationships:

### `catalogue` — 102 shop products

- `product_id` (`TEXT`, primary key): stable product identifier used in URLs, inventory joins, searches, and chat cards.
- `name` (`TEXT`, required): customer-facing product name.
- `garment_type` (`TEXT`, required): category used by browsing, filters, and catalogue search.
- `description` (`TEXT`, required): product copy used on detail pages and grounded assistant replies.
- `colors` (`TEXT`, required): JSON-encoded color list used for filtering and recommendations.
- `search_tags` (`TEXT`, required): JSON-encoded search keywords that improve catalogue discovery.
- `image_file_path` (`TEXT`, required): local product-image path used to render product photography.
- `price` (`REAL`, required): authoritative price shown by the site and returned by lookup tools.

`product_id` is the primary key. The table has no outgoing foreign keys; `inventory.product_id` references it.

### `inventory` — size-level stock

- `id` (`INTEGER`, primary key): unique inventory-row identifier.
- `product_id` (`TEXT`, required, foreign key to `catalogue.product_id`): identifies the stocked product.
- `size` (`TEXT`, required): size label such as XS, S, M, L, XL, or XXL.
- `quantity` (`INTEGER`, required): current number of units available for that product and size.

The database has a unique constraint for each product/size combination. Quantity is the source of truth for available, low-stock, and out-of-stock answers.

### `users` — customer accounts

- `id` (`INTEGER`, primary key): internal account identifier.
- `name` (`TEXT`, required): display name used for the account and safe personalization.
- `email` (`TEXT`, required, unique): login identifier and private customer context.
- `password_hash` (`TEXT`, required): PBKDF2-HMAC-SHA256 password record; it is never returned or sent to the agent.
- `created_at` (`TEXT`, default `datetime('now')`): account creation time.
- `first_name` (`TEXT`, nullable): signup name field and personalization source.
- `last_name` (`TEXT`, nullable): signup name field and personalization source.

### `chat_messages` — authenticated conversation memory

- `id` (`INTEGER`, primary key): message ordering identifier.
- `user_id` (`INTEGER`, required, foreign key to `users.id`): owner of the message history.
- `role` (`TEXT`, required): `user` or `assistant`.
- `content` (`TEXT`, required): saved message text.
- `products_json` (`TEXT`, nullable): validated assistant product-card data for restoring recommendations.
- `created_at` (`TEXT`, default `datetime('now')`): message creation time.

Guests are not written to `chat_messages`. The app does not modify catalogue or inventory during chatbot lookups.

## Authentication and privacy

`POST /api/auth/signup` validates names, email, and matching passwords, then relies on the unique email constraint to reject duplicates. `POST /api/auth/login` verifies the submitted password against the stored hash. Passwords use PBKDF2-HMAC-SHA256 with a random salt and 120,000 iterations, followed by constant-time comparison. API responses expose only the public profile fields (`id`, `name`, `email`, `first_name`, `last_name`, `created_at`); password text and hashes are never returned, logged, or stored in frontend state.

## Frontend, API, and agent flow

The Vite React frontend uses `VITE_API_BASE_URL` when set, otherwise `http://localhost:8000`. Product pages call `GET /api/products` and `GET /api/products/{product_id}`. Product images are served by FastAPI under `/images/` from `data/products/`.

The chat widget sends JSON to the exact endpoint `POST /api/chat`:

```json
{"message":"...", "user_id": null, "page_context": null}
```

`user_id` and `page_context` are optional. FastAPI validates the product page context against the catalogue, loads the authenticated user's own history, calls `run_shop_agent`, and returns `ChatResponse` (`message` plus grounded `products`). For signed-in users, it saves the user and assistant messages after a successful run. `GET /api/chat/history?user_id=...` restores that user's saved messages and cards.

`backend/agent.py` creates an actual `pydantic_ai.Agent` with `OpenAIChatModel` and `OpenAIProvider`. The API key is loaded from the repository-root `.env` as `PORTKEY_API_KEY`; the provider uses `PORTKEY_BASE_URL` or its default `https://api.portkey.ai/v1`, with the `x-portkey-api-key` header. The model is `MODEL_NAME` when configured, otherwise `gpt-5.6-luna`. The system prompt is read at startup from `backend/prompts/prompt.md`.

The required agent files stay separated:

- `backend/prompts/prompt.md`: voice, grounding instructions, privacy, safety, search, comparison, and clarification rules.
- `backend/agent.py`: environment/provider setup, PydanticAI `Agent`, safe request context, clarification behavior, grounding of returned cards, and audit events.
- `backend/tools.py`: parameterized, read-only SQLite tools and trusted product-card lookup helpers.
- `backend/models.py`: all Pydantic request, response, product, context, history, audit, and dependency types.
- `backend/main.py`: FastAPI routes, database connections, product endpoints, authentication integration, history persistence, and chat orchestration.

## Models in `backend/models.py`

- `ProductLookup`: `product_id`, `name`, `description`, `price`; minimum catalogue facts for grounded product and price replies.
- `InventoryLookup`: `product_id`, `name`, `size`, `quantity`; enough for all-size and one-size stock answers.
- `ComparisonProduct`: `product_id`, `name`, `garment_type`, `colors`, `description`, `price`, `stock_by_size`; fields for factual comparison.
- `ChatProductMatch`: `product_id`, `name`, `price`, `description`, `image_file_path`; fields needed for a trusted frontend recommendation card.
- `CustomerContext`: `user_id`, `name`, `email`; safe personalization and ownership context, with no password fields.
- `PageContext`: `product_id`, `name`; the verified product currently open for “this” and “it” questions.
- `ChatHistoryMessage`: `role`, `content`, `products`, `created_at`; restores text and prior grounded cards.
- `ChatHistoryResponse`: `messages`; history-loading response envelope.
- `ChatRequest`: `message`, optional `user_id`, optional `page_context`; chat input. Message length is 1–2000 characters.
- `ChatResponse`: `message`, `products`; structured agent output returned to React.
- `AuditTrailEntry`: `timestamp`, `iteration`, `tool_name`, `action`, string `arguments`, `result`, optional `stop_reason`; validated concise agent-loop records.
- `ChatDependencies`: optional `customer`, `page_context`, and `history`, plus the request audit callback and mutable `audit_iteration`; PydanticAI context for one request.

## Agent abilities and tools

Registered PydanticAI tools in `backend/tools.py` are:

- `find_products(query) -> list[ProductLookup]`: parameterized search across product ID, name, garment type, description, colors, and search tags.
- `get_product_info(product_id) -> ProductLookup | None`: exact database description and price lookup.
- `get_inventory(product_id) -> list[InventoryLookup]`: all recorded size quantities for one exact product.
- `check_stock_by_size(product_id, size) -> InventoryLookup | None`: one exact product-size quantity, or no result when unavailable.
- `compare_products(product_ids) -> list[ComparisonProduct]`: real price, category, colors, description, and size stock for two to four unique products.

Tool helpers are `_connection` (read-only database connection), `_search_terms` (normalizes query words), `_product_lookup` and `_inventory_lookup` (convert rows to models), `_string_list` (decodes catalogue JSON lists), `_record_tool` (sends concise tool events to the request audit callback), `_chat_match_for_row` (builds a trusted card), and `chat_product_match_for_id` / `chat_product_matches_for_query` (ground cards by exact ID or fallback search). In `agent.py`, `load_root_env` loads local configuration, `context_for_agent` formats safe customer/page/history context, `clarification_for_request` handles broad requests, `_short_audit_text` redacts/truncates audit values, `append_audit_event` validates and appends records, and `_record_event` increments request iterations. All SQL values are parameterized. Prices come from `catalogue.price`, descriptions and attributes from `catalogue`, and stock from `inventory.quantity`; the agent is instructed not to answer these facts from memory.

For dynamic search, the flow is customer message → agent `find_products` → structured `ChatResponse.products` → frontend reusable product cards. The cards open the same `/products/{product_id}` detail route, which loads the full real description, image, price, colors, and inventory. The agent also supports factual comparisons and asks one narrowing question for broad requests when page/history context does not already answer the missing preference.

## Customer memory and page context

For a logged-in customer, FastAPI loads up to 40 recent database messages, while the agent context uses only the last 20. It passes only `CustomerContext` (`user_id`, name, email), the verified `PageContext`, and that user's own history. It never loads another user's records. After a successful response, both roles are saved, with assistant cards in `products_json`. Guests can chat but are not persisted.

## Audit trail

`output/audit_trail.json` is a JSON array that is extended rather than reset. Every appended record is constructed and validated as `AuditTrailEntry` before writing. Normal agent tool calls log the tool name, `tool_call` action, concise safe arguments, and a short result; the agent then logs a final `stop` event with `completed`, `clarification_requested`, or `error`. Iterations are request-scoped and increment for each tool/final event. Search text, customer messages, emails, passwords, hashes, API keys, and secrets are not logged; common secret-like values are redacted and values are truncated.

## Safety rules

The system prompt requires database grounding for product details, prices, sizes, colors, recommendations, and stock; unavailable or unknown information is stated plainly. It forbids exposing passwords, password hashes, API keys, internal secrets, sensitive data, another customer's account or chat history, and any memory other than the signed-in customer's own history. User messages, page context, catalogue values, and history are treated as data rather than instructions that can override the system prompt. The assistant does not claim unsupported purchases or account changes, avoids unnecessary personal-data collection, and only returns recommendations/search results grounded in real catalogue records.

## Actual limits and configuration

- PydanticAI `Agent` retries is configured to `2`.
- `find_products` SQL returns at most 8 rows.
- `compare_products` accepts two or more unique IDs and truncates the request to 4 IDs.
- Chat input is limited to 1–2000 characters by `ChatRequest`.
- Database history loading is limited to 40 messages; only the last 20 are placed in the agent context.
- There is no application-configured overall agent iteration cap.
- There is no application-configured model token/output limit.
- There is no application-configured network timeout or retry policy beyond PydanticAI's agent retry setting.
- There is no separate frontend result cap; catalogue search is bounded by the tool's eight-row SQL limit.

## Run commands

From `Homework 04/hw4/backend`:

```bash
uvicorn main:app --reload --port 8000
```

From `Homework 04/hw4/frontend`:

```bash
npm install
npm run dev
```

The backend requires `PORTKEY_API_KEY` in the project-root `.env`; `.env.example` contains placeholders only. The final project expects the unchanged local data pack at `hw4/data/campus_customs.db` and `hw4/data/products/`.
