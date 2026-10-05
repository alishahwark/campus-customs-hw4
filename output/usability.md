# Usability

## Frontend improvement 1: Product search, filtering and sorting

The Products page now has keyword search, garment-type and color filters, minimum and maximum price inputs, price sorting, and a clear-filters control. Results update immediately from the catalogue already loaded in the page. This helps shoppers browse directly, narrow a large collection quickly, and find products within a budget without needing the chatbot.

## Frontend improvement 2: Recently viewed products

Opening a product detail page stores its product ID in browser local storage. The Products page shows the most recent products in a compact, clickable row with a clear option. This helps returning shoppers pick up where they left off, including guests who do not have an account.

## Agent/backend improvement 1: Comparison tool

The PydanticAI agent now has `compare_products`, a read-only, parameterized SQLite tool that returns real product names, prices, garment types, colors, descriptions, and stock by size for two to four product IDs. The prompt directs comparison requests through product search and this tool. This gives shoppers a concise factual side-by-side view and helps them make a purchase decision without invented product facts.

## Agent/backend improvement 2: Conversation-aware clarification

The agent now detects broad shopping-intent requests such as “I need a sweatshirt” and asks one targeted narrowing question, starting with missing size, color, budget, or style information. It uses prior conversation and current product-page context, so it does not ask for information already available. This reduces random product lists and makes the next recommendation more relevant for the shopper and more useful for conversion.
