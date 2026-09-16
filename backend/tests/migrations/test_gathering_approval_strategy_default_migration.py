"""Migration checks for gathering-level approval strategy defaults."""

import uuid
from unittest.mock import MagicMock, patch

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlmodel import Session, select

from app.alembic.versions import (
    a6f4c2e9d1b7_gathering_approval_strategy_default as migration,
)
from app.api.approval_strategy.models import ApprovalStrategies
from app.api.approval_strategy.schemas import ApprovalStrategyType


def _config(connection) -> Config:
    config = Config("alembic.ini")
    config.attributes["connection"] = connection
    return config


def test_sales_flow_ownership_is_nullable_and_auto_accept_is_the_default(
    db: Session,
) -> None:
    row = (
        db.connection()
        .exec_driver_sql(
            """
        SELECT is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'approvalstrategies'
          AND column_name = 'sales_flow_id'
        """
        )
        .one()
    )
    strategy_default = (
        db.connection()
        .exec_driver_sql(
            """
        SELECT column_default
        FROM information_schema.columns
        WHERE table_name = 'approvalstrategies'
          AND column_name = 'strategy_type'
        """
        )
        .scalar_one()
    )

    assert row[0] == "YES"
    assert migration.AUTO_ACCEPT_DB_VALUE in strategy_default


def test_shared_and_flow_strategy_unique_indexes_exist(db: Session) -> None:
    rows = (
        db.connection()
        .exec_driver_sql(
            """
        SELECT indexname, indexdef
        FROM pg_indexes
        WHERE tablename = 'approvalstrategies'
          AND indexname IN (
            'uq_approval_strategy_flow',
            'uq_approval_strategy_popup_shared'
          )
        """
        )
        .all()
    )
    indexes = {row[0]: row[1] for row in rows}

    assert "sales_flow_id IS NOT NULL" in indexes["uq_approval_strategy_flow"]
    assert "sales_flow_id IS NULL" in indexes["uq_approval_strategy_popup_shared"]


def test_upgrade_backfill_is_readable_by_the_orm(migration_test_engine) -> None:
    tenant_id = uuid.uuid4()
    popup_id = uuid.uuid4()
    flow_id = uuid.uuid4()
    params = {
        "tenant": tenant_id,
        "tenant_slug": f"strategy-migration-{tenant_id}",
        "popup": popup_id,
        "popup_slug": f"strategy-migration-{popup_id}",
        "flow": flow_id,
    }

    with migration_test_engine.begin() as connection:
        config = _config(connection)
        command.upgrade(config, migration.revision)
        command.downgrade(config, migration.down_revision)
        connection.execute(
            text(
                "INSERT INTO tenants (id, name, slug) "
                "VALUES (:tenant, 'Strategy migration tenant', :tenant_slug)"
            ),
            params,
        )
        connection.execute(
            text(
                "INSERT INTO popups (id, tenant_id, name, slug, status) "
                "VALUES (:popup, :tenant, 'Strategy migration popup', "
                ":popup_slug, 'draft')"
            ),
            params,
        )
        connection.execute(
            text(
                "INSERT INTO sales_flows "
                "(id, tenant_id, popup_id, type, slug, name, is_default) "
                "VALUES (:flow, :tenant, :popup, 'application', 'attendee', "
                "'Default flow', true)"
            ),
            params,
        )

        command.upgrade(config, migration.revision)

        with Session(
            bind=connection,
            join_transaction_mode="create_savepoint",
        ) as session:
            strategy = session.exec(
                select(ApprovalStrategies).where(
                    ApprovalStrategies.popup_id == popup_id,
                    ApprovalStrategies.sales_flow_id.is_(None),
                )
            ).one()

        assert strategy.strategy_type == ApprovalStrategyType.AUTO_ACCEPT

        connection.execute(
            text("DELETE FROM popups WHERE id = :popup"),
            params,
        )
        connection.execute(
            text("DELETE FROM tenants WHERE id = :tenant"),
            params,
        )


def _result(rows: list[tuple[uuid.UUID]]) -> MagicMock:
    result = MagicMock()
    result.all.return_value = rows
    return result


def test_downgrade_refuses_to_drop_a_strategy_without_a_default_flow() -> None:
    popup_id = uuid.uuid4()
    connection = MagicMock()
    connection.execute.return_value = _result([(popup_id,)])

    with patch.object(migration, "op") as mock_op:
        mock_op.get_bind.return_value = connection

        with pytest.raises(RuntimeError, match="without a default sales flow"):
            migration.downgrade()

        mock_op.drop_index.assert_not_called()


def test_downgrade_refuses_to_discard_a_colliding_strategy() -> None:
    popup_id = uuid.uuid4()
    connection = MagicMock()
    connection.execute.side_effect = [_result([]), _result([(popup_id,)])]

    with patch.object(migration, "op") as mock_op:
        mock_op.get_bind.return_value = connection

        with pytest.raises(RuntimeError, match="cannot be collapsed losslessly"):
            migration.downgrade()

        mock_op.drop_index.assert_not_called()
