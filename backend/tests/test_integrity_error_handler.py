import json
from types import SimpleNamespace

import pytest
from loguru import logger
from sqlalchemy.exc import IntegrityError
from starlette.requests import Request

from app.main import handle_integrity_error


@pytest.fixture
def _scrub_patron_state() -> None:
    """These handler unit tests need no database state."""


class DatabaseError(Exception):
    def __init__(self, sqlstate: str | None, *, pgcode: str | None = None):
        super().__init__("sensitive value from database error")
        self.sqlstate = sqlstate
        self.pgcode = pgcode
        self.diag = SimpleNamespace(
            schema_name="public",
            table_name="invites",
            constraint_name="invites_referrer_human_id_fkey",
        )


@pytest.mark.parametrize(
    ("sqlstate", "expected_status", "expected_detail", "category"),
    [
        ("23505", 409, "A record with this data already exists", "unique_constraint"),
        ("23503", 404, "Referenced record not found", "foreign_key"),
        ("23514", 422, "Invalid field value", "check_constraint"),
        ("42501", 403, "Access denied by security policy", "security_policy"),
        ("23000", 400, "Data integrity error", "other"),
    ],
)
def test_integrity_error_uses_psycopg3_sqlstate_and_logs_diagnostics(
    sqlstate: str,
    expected_status: int,
    expected_detail: str,
    category: str,
) -> None:
    messages = []
    sink = logger.add(messages.append, format="{message}")
    try:
        request = Request(
            {
                "type": "http",
                "method": "DELETE",
                "path": "/api/v1/humans/123",
                "headers": [],
            }
        )
        exc = IntegrityError(
            "DELETE FROM humans WHERE id = :id",
            {"id": "private"},
            DatabaseError(sqlstate),
        )

        response = handle_integrity_error(request, exc)
    finally:
        logger.remove(sink)

    assert response.status_code == expected_status
    assert json.loads(response.body) == {"detail": expected_detail}
    assert len(messages) == 1
    message = str(messages[0])
    for field in (
        f"category={category}",
        f"sqlstate={sqlstate}",
        "schema=public",
        "table=invites",
        "constraint=invites_referrer_human_id_fkey",
        "method=DELETE",
        "path=/api/v1/humans/123",
    ):
        assert field in message
    assert "sensitive value" not in message
    assert "private" not in message


def test_integrity_error_does_not_use_psycopg2_pgcode() -> None:
    request = Request({"type": "http", "method": "POST", "path": "/", "headers": []})
    exc = IntegrityError("INSERT", {}, DatabaseError(None, pgcode="23505"))

    response = handle_integrity_error(request, exc)

    assert response.status_code == 400
    assert json.loads(response.body) == {"detail": "Data integrity error"}
