"""Materialize missing historical ProductUnits.

Revision ID: f4b8c2d7e1a9
Revises: c9a4e7b2d1f8
"""

import secrets
import string
import uuid
from collections.abc import Sequence
from typing import Any

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f4b8c2d7e1a9"
down_revision: str | Sequence[str] | None = "c9a4e7b2d1f8"
branch_labels = depends_on = None

_CODE_ALPHABET = string.ascii_uppercase
_CODE_LENGTH = 8


def _attendee(
    bind: sa.Connection,
    attendee_id: uuid.UUID,
    *,
    tenant_id: uuid.UUID,
    popup_id: uuid.UUID,
) -> Any | None:
    return (
        bind.execute(
            sa.text("""
            SELECT id,human_id,category_id
            FROM attendees
            WHERE id=:id AND tenant_id=:tenant_id AND popup_id=:popup_id
            """),
            {"id": attendee_id, "tenant_id": tenant_id, "popup_id": popup_id},
        )
        .mappings()
        .first()
    )


def _recipient_attendee(bind: sa.Connection, line: Any) -> Any | None:
    if line["recipient_id"] is None:
        return None
    attendee_id = line["recipient_attendee_id"]
    existing_attendee_id = line["recipient_existing_attendee_id"]
    if (
        attendee_id is not None
        and existing_attendee_id is not None
        and attendee_id != existing_attendee_id
    ):
        return None

    selected_id = attendee_id or existing_attendee_id
    if selected_id is not None:
        attendee = _attendee(
            bind,
            selected_id,
            tenant_id=line["tenant_id"],
            popup_id=line["popup_id"],
        )
        candidates = [attendee] if attendee is not None else []
    elif line["recipient_human_id"] is not None:
        candidates = list(
            bind.execute(
                sa.text("""
                SELECT id,human_id,category_id
                FROM attendees
                WHERE tenant_id=:tenant_id
                  AND popup_id=:popup_id
                  AND human_id=:human_id
                ORDER BY created_at,id
                """),
                {
                    "tenant_id": line["tenant_id"],
                    "popup_id": line["popup_id"],
                    "human_id": line["recipient_human_id"],
                },
            )
            .mappings()
            .all()
        )
    else:
        candidates = []

    if len(candidates) != 1:
        return None
    attendee = candidates[0]
    if attendee["category_id"] != line["recipient_category_id"]:
        return None
    if (
        line["recipient_human_id"] is not None
        and attendee["human_id"] != line["recipient_human_id"]
    ):
        return None
    return attendee


def _resolve_attendee(bind: sa.Connection, line: Any) -> uuid.UUID | None:
    direct = None
    if line["attendee_id"] is not None:
        direct = _attendee(
            bind,
            line["attendee_id"],
            tenant_id=line["tenant_id"],
            popup_id=line["popup_id"],
        )
        if direct is None:
            return None

    recipient = None
    if line["payment_recipient_id"] is not None:
        recipient = _recipient_attendee(bind, line)
        if recipient is None:
            return None

    if direct is not None and recipient is not None and direct["id"] != recipient["id"]:
        return None
    attendee = direct or recipient
    if attendee is None:
        return None
    if (
        line["attendee_category_id"] is not None
        and attendee["category_id"] != line["attendee_category_id"]
    ):
        return None
    return attendee["id"]


def _operational_lines(bind: sa.Connection) -> list[Any]:
    return list(
        bind.execute(
            sa.text("""
            SELECT
              line.id,line.tenant_id,line.payment_id,line.product_id,
              line.attendee_id,line.payment_recipient_id,line.quantity,
              line.product_category,line.requires_check_in_snapshot,
              line.purchase_metadata,payment.popup_id,
              product.attendee_category_id,
              recipient.id AS recipient_id,
              recipient.human_id AS recipient_human_id,
              recipient.existing_attendee_id AS recipient_existing_attendee_id,
              recipient.attendee_id AS recipient_attendee_id,
              recipient.category_id AS recipient_category_id
            FROM payment_products line
            JOIN payments payment
              ON payment.id=line.payment_id
             AND payment.tenant_id=line.tenant_id
            JOIN products product
              ON product.id=line.product_id
             AND product.tenant_id=payment.tenant_id
             AND product.popup_id=payment.popup_id
            LEFT JOIN payment_recipients recipient
              ON recipient.id=line.payment_recipient_id
             AND recipient.payment_id=line.payment_id
             AND recipient.tenant_id=line.tenant_id
            WHERE payment.status='approved'
              AND payment.payment_type IS DISTINCT FROM 'application_fee'
              AND line.quantity > 0
              AND (
                lower(line.product_category)='ticket'
                OR line.attendee_id IS NOT NULL
                OR line.payment_recipient_id IS NOT NULL
                OR line.requires_check_in_snapshot IS TRUE
              )
            ORDER BY line.created_at,line.id
            """)
        )
        .mappings()
        .all()
    )


def _plan_backfill(bind: sa.Connection) -> tuple[list[dict[str, Any]], dict[str, int]]:
    lines = _operational_lines(bind)
    line_ids = [line["id"] for line in lines]
    existing = (
        {
            (row.payment_product_id, row.unit_index)
            for row in bind.execute(
                sa.text("""
                SELECT payment_product_id,unit_index
                FROM attendee_products
                WHERE payment_product_id = ANY(:line_ids)
                """),
                {"line_ids": line_ids},
            )
        }
        if line_ids
        else set()
    )
    report = {
        "operational_lines": len(lines),
        "existing_lineage": 0,
        "ambiguous_unlinked": 0,
        "unresolved_attendee": 0,
        "planned": 0,
        "inserted": 0,
    }
    planned: list[dict[str, Any]] = []

    for line in lines:
        attendee_class = (
            line["product_category"].lower() == "ticket"
            or line["attendee_id"] is not None
            or line["payment_recipient_id"] is not None
        )
        attendee_id = _resolve_attendee(bind, line) if attendee_class else None
        if attendee_class and attendee_id is None:
            report["unresolved_attendee"] += 1
            continue

        unlinked = bind.execute(
            sa.text("""
            SELECT count(*)
            FROM attendee_products
            WHERE payment_id=:payment_id
              AND payment_product_id IS NULL
              AND product_id=:product_id
              AND attendee_id IS NOT DISTINCT FROM :attendee_id
            """),
            {
                "payment_id": line["payment_id"],
                "product_id": line["product_id"],
                "attendee_id": attendee_id,
            },
        ).scalar_one()
        if unlinked:
            report["ambiguous_unlinked"] += 1
            continue

        for unit_index in range(line["quantity"]):
            lineage = (line["id"], unit_index)
            if lineage in existing:
                report["existing_lineage"] += 1
                continue
            planned.append(
                {
                    "tenant_id": line["tenant_id"],
                    "attendee_id": attendee_id,
                    "product_id": line["product_id"],
                    "payment_id": line["payment_id"],
                    "payment_product_id": line["id"],
                    "unit_index": unit_index,
                    "product_category_snapshot": line["product_category"],
                    "requires_check_in_snapshot": line["requires_check_in_snapshot"],
                    "purchase_metadata": line["purchase_metadata"],
                }
            )

    report["planned"] = len(planned)
    return planned, report


def _check_in_code(used_codes: set[str]) -> str:
    while True:
        code = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_LENGTH))
        if code not in used_codes:
            used_codes.add(code)
            return code


def _backfill(bind: sa.Connection) -> dict[str, int]:
    planned, report = _plan_backfill(bind)
    used_codes = set(
        bind.execute(sa.text("SELECT check_in_code FROM attendee_products")).scalars()
    )
    statement = sa.text("""
        INSERT INTO attendee_products
          (id,tenant_id,attendee_id,product_id,check_in_code,payment_id,
           payment_product_id,unit_index,product_category_snapshot,
           requires_check_in_snapshot,purchase_metadata)
        VALUES
          (:id,:tenant_id,:attendee_id,:product_id,:check_in_code,:payment_id,
           :payment_product_id,:unit_index,:product_category_snapshot,
           :requires_check_in_snapshot,:purchase_metadata)
        ON CONFLICT (payment_product_id,unit_index)
          WHERE payment_product_id IS NOT NULL
        DO NOTHING
        """)
    statement = statement.bindparams(
        sa.bindparam("purchase_metadata", type_=postgresql.JSONB())
    )
    for unit in planned:
        result = bind.execute(
            statement,
            {
                **unit,
                "id": uuid.uuid4(),
                "check_in_code": _check_in_code(used_codes),
            },
        )
        report["inserted"] += result.rowcount

    values = ", ".join(f"{key}={value}" for key, value in report.items())
    print(f"[{revision}] product unit materialization report: {values}")  # noqa: T201
    return report


def upgrade() -> None:
    _backfill(op.get_bind())


def downgrade() -> None:
    # Data downgrade is intentionally a no-op: materialized units may already
    # own QR identity and check-in history, so deleting them would corrupt history.
    pass
