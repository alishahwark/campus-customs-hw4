"""Product catalogue and account API for the Homework 4 storefront."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from agent import run_shop_agent
from auth import (
    EMAIL_PATTERN,
    DuplicateEmailError,
    authenticate_user,
    create_user,
)
from models import (
    ChatHistoryMessage,
    ChatHistoryResponse,
    ChatProductMatch,
    ChatRequest,
    ChatResponse,
    CustomerContext,
    PageContext,
)


PROJECT_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_DIR / "data"
if not DATA_DIR.is_dir():
    # Local course workspace fallback; the standalone submission uses PROJECT_DIR/data.
    DATA_DIR = PROJECT_DIR.parent / "data"
DATABASE_PATH = DATA_DIR / "campus_customs.db"
PRODUCTS_DIR = DATA_DIR / "products"

app = FastAPI(title="Campus Customs API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.mount("/images", StaticFiles(directory=PRODUCTS_DIR), name="product-images")


def parse_json_list(value: str) -> list[str]:
    """Decode JSON list fields stored as TEXT in the SQLite catalogue."""
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return []
    return parsed if isinstance(parsed, list) else []


def get_connection() -> sqlite3.Connection:
    """Open the local database in read-only mode for every request."""
    if not DATABASE_PATH.is_file():
        raise RuntimeError(f"Database not found at {DATABASE_PATH}")
    connection = sqlite3.connect(f"file:{DATABASE_PATH}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    return connection


def get_write_connection() -> sqlite3.Connection:
    """Open the local database for the account/chat writes required by the app."""
    connection = sqlite3.connect(DATABASE_PATH)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def customer_for_user_id(user_id: int) -> CustomerContext | None:
    """Load only the safe customer fields needed for personalization."""
    with get_connection() as connection:
        row = connection.execute(
            "SELECT id, name, email FROM users WHERE id = ?",
            (user_id,),
        ).fetchone()
    if row is None:
        return None
    return CustomerContext(user_id=row["id"], name=row["name"], email=row["email"])


def canonical_page_context(page_context: PageContext | None) -> PageContext | None:
    """Verify the browser's current product and use the catalogue's real name."""
    if page_context is None:
        return None
    with get_connection() as connection:
        row = connection.execute(
            "SELECT product_id, name FROM catalogue WHERE product_id = ?",
            (page_context.product_id,),
        ).fetchone()
    if row is None:
        return None
    return PageContext(product_id=row["product_id"], name=row["name"])


def products_from_json(value: str | None) -> list[ChatProductMatch]:
    """Decode stored assistant cards without exposing arbitrary database fields."""
    if not value:
        return []
    try:
        parsed = json.loads(value)
    except (TypeError, json.JSONDecodeError):
        return []
    if not isinstance(parsed, list):
        return []
    products: list[ChatProductMatch] = []
    for item in parsed:
        try:
            products.append(ChatProductMatch.model_validate(item))
        except (TypeError, ValueError):
            continue
    return products


def load_chat_history(user_id: int, limit: int = 40) -> list[ChatHistoryMessage]:
    """Load the most recent saved exchange messages in conversation order."""
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT role, content, products_json, created_at
            FROM chat_messages
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT ?
            """,
            (user_id, limit),
        ).fetchall()
    messages: list[ChatHistoryMessage] = []
    for row in reversed(rows):
        if row["role"] not in {"user", "assistant"}:
            continue
        messages.append(
            ChatHistoryMessage(
                role=row["role"],
                content=row["content"],
                products=products_from_json(row["products_json"]),
                created_at=row["created_at"],
            )
        )
    return messages


def save_chat_exchange(user_id: int, user_message: str, response: ChatResponse) -> None:
    """Persist one complete user/assistant exchange for a known account."""
    products_json = json.dumps(
        [product.model_dump() for product in response.products],
        separators=(",", ":"),
    )
    connection = get_write_connection()
    try:
        connection.execute(
            """
            INSERT INTO chat_messages (user_id, role, content, products_json)
            VALUES (?, 'user', ?, NULL)
            """,
            (user_id, user_message),
        )
        connection.execute(
            """
            INSERT INTO chat_messages (user_id, role, content, products_json)
            VALUES (?, 'assistant', ?, ?)
            """,
            (user_id, response.message, products_json),
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def product_from_row(row: sqlite3.Row) -> dict[str, Any]:
    """Convert a catalogue row into the frontend's product shape."""
    image_path = Path(row["image_file_path"])
    return {
        "product_id": row["product_id"],
        "name": row["name"],
        "garment_type": row["garment_type"],
        "description": row["description"],
        "colors": parse_json_list(row["colors"]),
        "search_tags": parse_json_list(row["search_tags"]),
        "image_file_path": row["image_file_path"],
        "image_url": f"/images/{image_path.name}",
        "price": float(row["price"]),
    }


def inventory_for_product(connection: sqlite3.Connection, product_id: str) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT size, quantity
        FROM inventory
        WHERE product_id = ?
        ORDER BY CASE size
            WHEN 'XS' THEN 1
            WHEN 'S' THEN 2
            WHEN 'M' THEN 3
            WHEN 'L' THEN 4
            WHEN 'XL' THEN 5
            WHEN 'XXL' THEN 6
            ELSE 7
        END
        """,
        (product_id,),
    ).fetchall()
    return [{"size": row["size"], "quantity": row["quantity"]} for row in rows]


class SignupRequest(BaseModel):
    first_name: str = Field(min_length=1, max_length=80)
    last_name: str = Field(min_length=1, max_length=80)
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str = Field(min_length=8, max_length=128)


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=128)


@app.get("/")
def read_root() -> dict[str, str]:
    return {"message": "Campus Customs API"}


@app.get("/api/health")
def health_check() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest) -> ChatResponse:
    customer = None
    history: list[ChatHistoryMessage] = []
    page_context = canonical_page_context(request.page_context)
    if request.user_id is not None:
        customer = customer_for_user_id(request.user_id)
        if customer is None:
            raise HTTPException(status_code=401, detail="Please sign in again to use saved chat history.")
        history = load_chat_history(customer.user_id)
    try:
        response = await run_shop_agent(
            request.message,
            customer=customer,
            page_context=page_context,
            history=history,
        )
        if customer is not None:
            save_chat_exchange(customer.user_id, request.message, response)
        return response
    except Exception:
        raise HTTPException(
            status_code=502,
            detail="The shopping assistant is temporarily unavailable.",
        ) from None


@app.get("/api/chat/history", response_model=ChatHistoryResponse)
def chat_history(user_id: int) -> ChatHistoryResponse:
    if customer_for_user_id(user_id) is None:
        raise HTTPException(status_code=404, detail="Customer history not found.")
    return ChatHistoryResponse(messages=load_chat_history(user_id))


@app.post("/api/auth/signup", status_code=201)
def signup(request: SignupRequest) -> dict[str, Any]:
    first_name = request.first_name.strip()
    last_name = request.last_name.strip()
    email = request.email.strip().lower()

    if not first_name or not last_name:
        raise HTTPException(status_code=400, detail="First name and last name are required.")
    if not EMAIL_PATTERN.fullmatch(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")
    if request.password != request.confirm_password:
        raise HTTPException(status_code=400, detail="Passwords do not match.")

    try:
        user = create_user(
            DATABASE_PATH,
            first_name=first_name,
            last_name=last_name,
            email=email,
            password=request.password,
        )
    except DuplicateEmailError:
        raise HTTPException(status_code=409, detail="An account with this email already exists.") from None

    return {"message": "Account created successfully.", "user": user}


@app.post("/api/auth/login")
def login(request: LoginRequest) -> dict[str, Any]:
    email = request.email.strip().lower()
    if not EMAIL_PATTERN.fullmatch(email):
        raise HTTPException(status_code=400, detail="Enter a valid email address.")

    user = authenticate_user(DATABASE_PATH, email=email, password=request.password)
    if user is None:
        raise HTTPException(status_code=401, detail="Incorrect email or password.")
    return {"message": "Signed in successfully.", "user": user}


@app.get("/api/products")
def list_products() -> list[dict[str, Any]]:
    with get_connection() as connection:
        rows = connection.execute(
            """
            SELECT product_id, name, garment_type, description, colors,
                   search_tags, image_file_path, price
            FROM catalogue
            ORDER BY name
            """
        ).fetchall()
    return [product_from_row(row) for row in rows]


@app.get("/api/products/{product_id}")
def get_product(product_id: str) -> dict[str, Any]:
    with get_connection() as connection:
        row = connection.execute(
            """
            SELECT product_id, name, garment_type, description, colors,
                   search_tags, image_file_path, price
            FROM catalogue
            WHERE product_id = ?
            """,
            (product_id,),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="Product not found")

        product = product_from_row(row)
        product["inventory"] = inventory_for_product(connection, product_id)
        return product
