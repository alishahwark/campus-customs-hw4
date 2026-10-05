"""Read-only, parameterized SQLite tools exposed to the PydanticAI agent."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

from pydantic_ai import RunContext

from models import (
    ChatDependencies,
    ChatProductMatch,
    ComparisonProduct,
    InventoryLookup,
    ProductLookup,
)


PROJECT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_DIR / "data"
if not DATA_DIR.is_dir():
    # Local course workspace fallback; the standalone submission uses PROJECT_DIR/data.
    DATA_DIR = PROJECT_DIR.parent / "data"
DATABASE_PATH = DATA_DIR / "campus_customs.db"
SEARCH_STOP_WORDS = {
    "a", "about", "are", "can", "do", "does", "for", "have", "i", "in",
    "is", "me", "of", "please", "show", "the", "to", "what", "with", "you",
}
SIZE_ORDER = """
    CASE inventory.size
        WHEN 'XS' THEN 1
        WHEN 'S' THEN 2
        WHEN 'M' THEN 3
        WHEN 'L' THEN 4
        WHEN 'XL' THEN 5
        WHEN 'XXL' THEN 6
        ELSE 7
    END
"""


def _connection() -> sqlite3.Connection:
    if not DATABASE_PATH.is_file():
        raise RuntimeError(f"Database not found at {DATABASE_PATH}")
    connection = sqlite3.connect(f"file:{DATABASE_PATH}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def _search_terms(query: str) -> list[str]:
    terms: list[str] = []
    for raw_term in query.strip().lower().replace("/", " ").split():
        term = raw_term.strip(".,?!:;()[]{}")
        if not term or term in SEARCH_STOP_WORDS:
            continue
        if term.endswith("ies") and len(term) > 4:
            term = term[:-1]
        elif term.endswith("s") and len(term) > 3:
            term = term[:-1]
        terms.append(term)
    return terms


def _product_lookup(row: sqlite3.Row) -> ProductLookup:
    return ProductLookup(
        product_id=row["product_id"],
        name=row["name"],
        description=row["description"],
        price=float(row["price"]),
    )


def _inventory_lookup(row: sqlite3.Row) -> InventoryLookup:
    return InventoryLookup(
        product_id=row["product_id"],
        name=row["name"],
        size=row["size"],
        quantity=int(row["quantity"]),
    )


def _string_list(value: str | None) -> list[str]:
    try:
        parsed = json.loads(value or "[]")
    except json.JSONDecodeError:
        return []
    return [item for item in parsed if isinstance(item, str)] if isinstance(parsed, list) else []


def _record_tool(
    ctx: RunContext[ChatDependencies] | None,
    tool_name: str,
    arguments: dict[str, str],
    result: str,
) -> None:
    """Send a concise, non-sensitive tool event to the request audit callback."""
    if ctx is None:
        return
    dependencies = ctx.deps
    dependencies.audit_iteration += 1
    if dependencies.audit_callback is not None:
        dependencies.audit_callback(
            dependencies.audit_iteration,
            tool_name,
            "tool_call",
            arguments,
            result,
            None,
        )


def find_products(ctx: RunContext[ChatDependencies], query: str) -> list[ProductLookup]:
    """Search product IDs, names, descriptions, clothing types, colors, and tags."""
    terms = _search_terms(query)
    if not terms:
        terms = [query.strip().lower()] if query.strip() else []

    search_columns = (
        "lower(product_id)", "lower(name)", "lower(garment_type)",
        "lower(description)", "lower(colors)", "lower(search_tags)",
    )
    clauses: list[str] = []
    parameters: list[str] = []
    for term in terms:
        clauses.append("(" + " OR ".join(f"{column} LIKE ?" for column in search_columns) + ")")
        parameters.extend([f"%{term}%"] * len(search_columns))
    where_clause = f"WHERE {' OR '.join(clauses)}" if clauses else ""

    with _connection() as connection:
        rows = connection.execute(
            f"""
            SELECT product_id, name, description, price
            FROM catalogue
            {where_clause}
            ORDER BY name
            LIMIT 8
            """,
            parameters,
        ).fetchall()
    products = [_product_lookup(row) for row in rows]
    _record_tool(ctx, "find_products", {"term_count": str(len(terms))}, f"found {len(products)}")
    return products


def get_product_info(ctx: RunContext[ChatDependencies], product_id: str) -> ProductLookup | None:
    """Look up one product's real description and price by exact product ID."""
    with _connection() as connection:
        row = connection.execute(
            """
            SELECT product_id, name, description, price
            FROM catalogue
            WHERE product_id = ?
            """,
            (product_id.strip(),),
        ).fetchone()
    product = _product_lookup(row) if row else None
    _record_tool(ctx, "get_product_info", {"product_id": product_id.strip()}, "found" if product else "unavailable")
    return product


def get_inventory(ctx: RunContext[ChatDependencies], product_id: str) -> list[InventoryLookup]:
    """Return current quantities for every size of one exact product."""
    with _connection() as connection:
        rows = connection.execute(
            f"""
            SELECT inventory.product_id, catalogue.name, inventory.size, inventory.quantity
            FROM inventory
            JOIN catalogue ON catalogue.product_id = inventory.product_id
            WHERE inventory.product_id = ?
            ORDER BY {SIZE_ORDER}
            """,
            (product_id.strip(),),
        ).fetchall()
    inventory = [_inventory_lookup(row) for row in rows]
    _record_tool(ctx, "get_inventory", {"product_id": product_id.strip()}, f"returned {len(inventory)} sizes")
    return inventory


def check_stock_by_size(
    ctx: RunContext[ChatDependencies],
    product_id: str,
    size: str,
) -> InventoryLookup | None:
    """Return one exact product-size quantity, or None if unavailable."""
    with _connection() as connection:
        row = connection.execute(
            """
            SELECT inventory.product_id, catalogue.name, inventory.size, inventory.quantity
            FROM inventory
            JOIN catalogue ON catalogue.product_id = inventory.product_id
            WHERE inventory.product_id = ? AND upper(inventory.size) = upper(?)
            """,
            (product_id.strip(), size.strip()),
        ).fetchone()
    inventory = _inventory_lookup(row) if row else None
    _record_tool(
        ctx,
        "check_stock_by_size",
        {"product_id": product_id.strip(), "size": size.strip().upper()},
        f"quantity {inventory.quantity}" if inventory else "unavailable",
    )
    return inventory


def compare_products(
    ctx: RunContext[ChatDependencies],
    product_ids: list[str],
) -> list[ComparisonProduct]:
    """Compare two to four exact catalogue products with their current stock."""
    normalized_ids = list(dict.fromkeys(product_id.strip() for product_id in product_ids if product_id.strip()))[:4]
    if len(normalized_ids) < 2:
        _record_tool(ctx, "compare_products", {"product_count": str(len(normalized_ids))}, "at least two required")
        return []

    placeholders = ", ".join("?" for _ in normalized_ids)
    with _connection() as connection:
        product_rows = connection.execute(
            f"""
            SELECT product_id, name, garment_type, colors, description, price
            FROM catalogue
            WHERE product_id IN ({placeholders})
            """,
            normalized_ids,
        ).fetchall()
        inventory_rows = connection.execute(
            f"""
            SELECT inventory.product_id, catalogue.name, inventory.size, inventory.quantity
            FROM inventory
            JOIN catalogue ON catalogue.product_id = inventory.product_id
            WHERE inventory.product_id IN ({placeholders})
            ORDER BY {SIZE_ORDER}
            """,
            normalized_ids,
        ).fetchall()

    inventory_by_product: dict[str, list[InventoryLookup]] = {product_id: [] for product_id in normalized_ids}
    for row in inventory_rows:
        inventory_by_product[row["product_id"]].append(_inventory_lookup(row))
    product_by_id = {row["product_id"]: row for row in product_rows}
    comparisons = [
        ComparisonProduct(
            product_id=product_id,
            name=product_by_id[product_id]["name"],
            garment_type=product_by_id[product_id]["garment_type"],
            colors=_string_list(product_by_id[product_id]["colors"]),
            description=product_by_id[product_id]["description"],
            price=float(product_by_id[product_id]["price"]),
            stock_by_size=inventory_by_product[product_id],
        )
        for product_id in normalized_ids
        if product_id in product_by_id
    ]
    _record_tool(ctx, "compare_products", {"product_count": str(len(normalized_ids))}, f"returned {len(comparisons)}")
    return comparisons


def _chat_match_for_row(row: sqlite3.Row) -> ChatProductMatch:
    return ChatProductMatch(
        product_id=row["product_id"],
        name=row["name"],
        price=float(row["price"]),
        description=row["description"],
        image_file_path=row["image_file_path"],
    )


def chat_product_match_for_id(product_id: str) -> ChatProductMatch | None:
    """Build one frontend chat match from trusted catalogue fields."""
    with _connection() as connection:
        row = connection.execute(
            """
            SELECT product_id, name, description, image_file_path, price
            FROM catalogue
            WHERE product_id = ?
            """,
            (product_id.strip(),),
        ).fetchone()
    return _chat_match_for_row(row) if row else None


def chat_product_matches_for_query(query: str) -> list[ChatProductMatch]:
    """Build grounded chat matches for a fallback catalogue search."""
    lookups = find_products(None, query)
    matches: list[ChatProductMatch] = []
    for lookup in lookups:
        match = chat_product_match_for_id(lookup.product_id)
        if match is not None:
            matches.append(match)
    return matches
