"""Migration coverage for users left active under deleted tenants."""

import uuid

from alembic import command
from alembic.config import Config
from sqlalchemy import text

REVISION = "b6d4e9f2a1c7"
PREVIOUS_REVISION = "a5c8e2f7b1d4"


def _config(connection) -> Config:
    config = Config("alembic.ini")
    config.attributes["connection"] = connection
    return config


def test_upgrade_soft_deletes_only_users_of_deleted_tenants(
    migration_test_engine,
) -> None:
    deleted_tenant_id = uuid.uuid4()
    active_tenant_id = uuid.uuid4()
    deleted_tenant_user_id = uuid.uuid4()
    active_tenant_user_id = uuid.uuid4()

    with migration_test_engine.begin() as connection:
        config = _config(connection)
        command.downgrade(config, PREVIOUS_REVISION)
        try:
            connection.execute(
                text(
                    """
                    INSERT INTO tenants (id, name, slug, deleted)
                    VALUES
                        (:deleted_tenant, 'Deleted tenant', :deleted_slug, true),
                        (:active_tenant, 'Active tenant', :active_slug, false)
                    """
                ),
                {
                    "deleted_tenant": deleted_tenant_id,
                    "deleted_slug": f"deleted-{deleted_tenant_id}",
                    "active_tenant": active_tenant_id,
                    "active_slug": f"active-{active_tenant_id}",
                },
            )
            connection.execute(
                text(
                    """
                    INSERT INTO users
                        (id, email, role, deleted, tenant_id, auth_code, auth_attempts)
                    VALUES
                        (:deleted_tenant_user, :deleted_email, 'ADMIN', false,
                         :deleted_tenant, '123456', 2),
                        (:active_tenant_user, :active_email, 'ADMIN', false,
                         :active_tenant, '654321', 1)
                    """
                ),
                {
                    "deleted_tenant_user": deleted_tenant_user_id,
                    "deleted_email": f"deleted-{deleted_tenant_user_id}@test.com",
                    "deleted_tenant": deleted_tenant_id,
                    "active_tenant_user": active_tenant_user_id,
                    "active_email": f"active-{active_tenant_user_id}@test.com",
                    "active_tenant": active_tenant_id,
                },
            )

            command.upgrade(config, REVISION)

            deleted_user = connection.execute(
                text(
                    """
                    SELECT deleted, auth_code, code_expiration, auth_attempts
                    FROM users
                    WHERE id = :user_id
                    """
                ),
                {"user_id": deleted_tenant_user_id},
            ).one()
            active_user = connection.execute(
                text(
                    """
                    SELECT deleted, auth_code, auth_attempts
                    FROM users
                    WHERE id = :user_id
                    """
                ),
                {"user_id": active_tenant_user_id},
            ).one()

            assert deleted_user == (True, None, None, 0)
            assert active_user == (False, "654321", 1)
        finally:
            connection.execute(
                text("DELETE FROM users WHERE tenant_id IN (:deleted, :active)"),
                {"deleted": deleted_tenant_id, "active": active_tenant_id},
            )
            connection.execute(
                text("DELETE FROM tenants WHERE id IN (:deleted, :active)"),
                {"deleted": deleted_tenant_id, "active": active_tenant_id},
            )
            command.upgrade(config, REVISION)
