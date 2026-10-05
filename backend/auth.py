"""Password hashing and account operations for the Campus Customs API."""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets
import sqlite3
from pathlib import Path
from typing import Any


HASH_ALGORITHM = "pbkdf2_sha256"
HASH_ITERATIONS = 120_000
EMAIL_PATTERN = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


class DuplicateEmailError(Exception):
    """Raised when an account email is already registered."""


def normalize_email(email: str) -> str:
    return email.strip().lower()


def hash_password(password: str) -> str:
    salt = secrets.token_urlsafe(11)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        HASH_ITERATIONS,
    ).hex()
    return f"{HASH_ALGORITHM}${salt}${digest}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, salt, expected_digest = stored_hash.split("$")
    except ValueError:
        return False
    if algorithm != HASH_ALGORITHM:
        return False
    actual_digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt.encode("utf-8"),
        HASH_ITERATIONS,
    ).hex()
    return hmac.compare_digest(actual_digest, expected_digest)


def public_user(row: sqlite3.Row) -> dict[str, Any]:
    """Return the user fields safe for API and frontend use."""
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "created_at": row["created_at"],
    }


def create_user(
    database_path: Path,
    *,
    first_name: str,
    last_name: str,
    email: str,
    password: str,
) -> dict[str, Any]:
    normalized_email = normalize_email(email)
    display_name = f"{first_name.strip()} {last_name.strip()}".strip()
    password_hash = hash_password(password)

    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        cursor = connection.execute(
            """
            INSERT INTO users (name, email, password_hash, first_name, last_name)
            VALUES (?, ?, ?, ?, ?)
            """,
            (display_name, normalized_email, password_hash, first_name.strip(), last_name.strip()),
        )
        connection.commit()
        row = connection.execute(
            "SELECT id, name, email, first_name, last_name, created_at FROM users WHERE id = ?",
            (cursor.lastrowid,),
        ).fetchone()
        return public_user(row)
    except sqlite3.IntegrityError as error:
        connection.rollback()
        if "users.email" in str(error) or "UNIQUE constraint failed" in str(error):
            raise DuplicateEmailError from error
        raise
    finally:
        connection.close()


def authenticate_user(database_path: Path, *, email: str, password: str) -> dict[str, Any] | None:
    normalized_email = normalize_email(email)
    connection = sqlite3.connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        row = connection.execute(
            "SELECT * FROM users WHERE email = ?",
            (normalized_email,),
        ).fetchone()
        if row is None or not verify_password(password, row["password_hash"]):
            return None
        return public_user(row)
    finally:
        connection.close()
