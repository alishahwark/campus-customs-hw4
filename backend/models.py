"""Pydantic and agent data models for the Campus Customs chatbot."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Literal

from pydantic import BaseModel, Field


class ProductLookup(BaseModel):
    """Minimal catalogue facts returned to the agent."""

    product_id: str
    name: str
    description: str
    price: float


class InventoryLookup(BaseModel):
    """One database-backed stock result for a product and size."""

    product_id: str
    name: str
    size: str
    quantity: int


class ComparisonProduct(BaseModel):
    """Database-backed facts used for a side-by-side product comparison."""

    product_id: str
    name: str
    garment_type: str
    colors: list[str]
    description: str
    price: float
    stock_by_size: list[InventoryLookup] = Field(default_factory=list)


class ChatProductMatch(BaseModel):
    """Minimal database-backed product match returned with a chat reply."""

    product_id: str
    name: str
    price: float
    description: str
    image_file_path: str


class CustomerContext(BaseModel):
    """Safe customer details made available to the shopping assistant."""

    user_id: int
    name: str
    email: str


class PageContext(BaseModel):
    """The product page currently open when a customer sends a message."""

    product_id: str
    name: str


class ChatHistoryMessage(BaseModel):
    """One persisted conversation message returned to the frontend/agent."""

    role: Literal["user", "assistant"]
    content: str
    products: list[ChatProductMatch] = Field(default_factory=list)
    created_at: str


class ChatHistoryResponse(BaseModel):
    messages: list[ChatHistoryMessage] = Field(default_factory=list)


class ChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    user_id: int | None = None
    page_context: PageContext | None = None


class ChatResponse(BaseModel):
    message: str
    products: list[ChatProductMatch] = Field(default_factory=list)


class AuditTrailEntry(BaseModel):
    """Validated, concise record of one agent-loop event."""

    timestamp: str
    iteration: int = Field(ge=1)
    tool_name: str
    action: str
    arguments: dict[str, str] = Field(default_factory=dict)
    result: str
    stop_reason: str | None = None


@dataclass
class ChatDependencies:
    """Request-scoped customer, page, and conversation context for the agent."""

    customer: CustomerContext | None = None
    page_context: PageContext | None = None
    history: list[ChatHistoryMessage] = field(default_factory=list)
    audit_callback: Callable[[int, str, str, dict[str, str], str, str | None], None] | None = None
    audit_iteration: int = 0
