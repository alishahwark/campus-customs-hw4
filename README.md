# Campus Customs — Homework 4

Campus Customs is a React/Vite storefront with a FastAPI backend, SQLite-backed catalogue and inventory tools, account authentication, customer-aware chat, dynamic product recommendations, and a Campus Concierge interface.

## Prerequisites

- Python 3.9+
- Node.js 18+
- npm
- A Portkey API key for the chatbot

## Local data pack

The data pack is intentionally excluded from Git. Before running the app, place it at the project root:

```text
hw4/
└── data/
    ├── campus_customs.db
    └── products/
```

The backend expects `data/campus_customs.db` and serves product images from `data/products/`. Do not commit the database or product images.

## Environment

Copy `.env.example` to `.env` in the project root and replace the placeholder API key:

```bash
cp .env.example .env
```

Required settings:

- `PORTKEY_API_KEY`: your Portkey API key; keep it only in the local `.env`.
- `MODEL_NAME`: model used by the PydanticAI agent; defaults to `gpt-5.6-luna`.
- `PORTKEY_BASE_URL`: optional OpenAI-compatible Portkey base URL; defaults to `https://api.portkey.ai/v1`.

## Backend

From `hw4/backend`, create and activate a virtual environment, then install dependencies:

```bash
python3 -m venv ../.venv
source ../.venv/bin/activate
pip install -r ../requirements.txt
```

Run the backend from the `backend/` directory:

```bash
uvicorn main:app --reload --port 8000
```

The API is available at `http://127.0.0.1:8000`. The chatbot uses `POST /api/chat`; product data is served by `GET /api/products`.

## Frontend

In a second terminal, from `hw4/frontend`:

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal, normally `http://127.0.0.1:5173/`. If the backend is running on another port, set `VITE_API_BASE_URL` before starting Vite:

```bash
VITE_API_BASE_URL=http://127.0.0.1:8001 npm run dev -- --host 127.0.0.1
```

## Using the app

Browse the catalogue, filter and sort products, open a product detail page to select a size and add it to the local shopping bag, and use the Campus Concierge chat for grounded product, price, inventory, search, comparison, and clarification questions. Create an account to enable saved chat history; guest chat remains available without persistence.

The `output/` folder contains the manager harness, design and usability notes, end-to-end app-check report/screenshots, and the append-only audit trail. The local `.env`, data pack, Python environment, frontend dependencies, and build output are ignored by Git.
