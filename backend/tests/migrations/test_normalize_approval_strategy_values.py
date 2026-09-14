"""Regression coverage for legacy lowercase approval strategy rows."""

import uuid
from unittest.mock import patch

from sqlalchemy import text
from sqlmodel import Session, select

from app.alembic.versions import (
    d4e8b1c7a2f9_normalize_approval_strategy_values as migration,
)
from app.api.approval_strategy.models import ApprovalStrategies
from app.api.approval_strategy.schemas import ApprovalStrategyType


def test_upgrade_normalizes_legacy_values_for_orm_reads(
    migration_test_engine,
) -> None:
    tenant_id = uuid.uuid4()
    rows = [(uuid.uuid4(), uuid.uuid4(), strategy) for strategy in ApprovalStrategyType]

    with migration_test_engine.begin() as connection:
        connection.execute(
            text(
                "INSERT INTO tenants (id, name, slug) "
                "VALUES (:id, 'Legacy strategy tenant', :slug)"
            ),
            {"id": tenant_id, "slug": f"legacy-strategy-{tenant_id}"},
        )
        for strategy_id, popup_id, strategy in rows:
            connection.execute(
                text(
                    "INSERT INTO popups (id, tenant_id, name, slug, status) "
                    "VALUES (:id, :tenant_id, 'Legacy strategy popup', :slug, 'draft')"
                ),
                {
                    "id": popup_id,
                    "tenant_id": tenant_id,
                    "slug": f"legacy-strategy-{popup_id}",
                },
            )
            connection.execute(
                text(
                    "INSERT INTO approvalstrategies "
                    "(id, popup_id, tenant_id, strategy_type) "
                    "VALUES (:id, :popup_id, :tenant_id, :strategy_type)"
                ),
                {
                    "id": strategy_id,
                    "popup_id": popup_id,
                    "tenant_id": tenant_id,
                    "strategy_type": strategy.value,
                },
            )

        with patch.object(migration, "op") as mock_op:
            mock_op.get_bind.return_value = connection
            migration.upgrade()
            migration.upgrade()

        strategy_ids = [row[0] for row in rows]
        with Session(
            bind=connection,
            join_transaction_mode="create_savepoint",
        ) as session:
            stored = session.exec(
                select(ApprovalStrategies).where(
                    ApprovalStrategies.id.in_(strategy_ids)  # type: ignore[attr-defined]
                )
            ).all()

        assert {row.strategy_type for row in stored} == set(ApprovalStrategyType)

        for _, popup_id, _ in rows:
            connection.execute(
                text("DELETE FROM popups WHERE id = :id"), {"id": popup_id}
            )
        connection.execute(
            text("DELETE FROM tenants WHERE id = :id"), {"id": tenant_id}
        )
