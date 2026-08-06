import uuid

import psycopg
import pytest
from sqlmodel import Session, select
from testcontainers.postgres import PostgresContainer

from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.shared.enums import CredentialType
from app.api.tenant.credential_models import TenantCredentials
from app.api.tenant.models import Tenants
from app.utils.encryption import decrypt
from tests._flow_helpers import assign_to_default_flow


def _get_tenant_dsn(
    db: Session,
    postgres_container: PostgresContainer,
    tenant_id: uuid.UUID,
    credential_type: CredentialType,
) -> str:
    """Build a libpq DSN for a tenant's usr_<hex> credential against the test container."""
    cred = db.exec(
        select(TenantCredentials).where(
            TenantCredentials.tenant_id == tenant_id,
            TenantCredentials.credential_type == credential_type,
        )
    ).first()
    assert cred is not None, f"No {credential_type} credential for tenant {tenant_id}"
    host = postgres_container.get_container_host_ip()
    port = int(postgres_container.get_exposed_port(5432))
    password = decrypt(cred.db_password_encrypted)
    return (
        f"host={host} port={port} dbname=test_db "
        f"user={cred.db_username} password={password} sslmode=disable"
    )


def _insert_sales_flow_as_owner(
    db: Session,
    *,
    flow_id: uuid.UUID,
    tenant_id: uuid.UUID,
    popup_id: uuid.UUID,
    slug: str,
    name: str,
) -> None:
    """Insert a sales_flows row via the table owner (bypasses RLS)."""
    from sqlalchemy import text

    db.exec(  # type: ignore[call-overload]
        text(
            "INSERT INTO sales_flows (id, tenant_id, popup_id, slug, name) "
            "VALUES (:id, :tenant_id, :popup_id, :slug, :name)"
        ).bindparams(
            id=flow_id,
            tenant_id=tenant_id,
            popup_id=popup_id,
            slug=slug,
            name=name,
        )
    )
    db.commit()


@pytest.fixture()
def sales_flow_tenant_a(db: Session, popup_tenant_a: Popups) -> uuid.UUID:
    """A sales_flows row owned by tenant A, inserted via the table owner."""
    flow_id = uuid.uuid4()
    _insert_sales_flow_as_owner(
        db,
        flow_id=flow_id,
        tenant_id=popup_tenant_a.tenant_id,
        popup_id=popup_tenant_a.id,
        slug=f"flow-a-{uuid.uuid4().hex[:8]}",
        name="Flow A",
    )
    return flow_id


class TestSalesFlowsRLS:
    """RLS coverage for the sales_flows table (task 1.7)."""

    def test_tenant_role_can_insert_and_read_own_flow(
        self,
        db: Session,
        postgres_container: PostgresContainer,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """tenant_role (CRUD credential) can INSERT and SELECT its own tenant's flow."""
        dsn = _get_tenant_dsn(db, postgres_container, tenant_a.id, CredentialType.CRUD)
        flow_id = str(uuid.uuid4())
        slug = f"flow-crud-{uuid.uuid4().hex[:8]}"
        with psycopg.connect(dsn, autocommit=True) as conn:
            conn.execute(
                "INSERT INTO sales_flows (id, tenant_id, popup_id, slug, name) "
                "VALUES (%s, %s, %s, %s, %s)",
                (flow_id, str(tenant_a.id), str(popup_tenant_a.id), slug, "CRUD Flow"),
            )
            row = conn.execute(
                "SELECT slug FROM sales_flows WHERE id = %s", (flow_id,)
            ).fetchone()
        assert row is not None
        assert row[0] == slug

    def test_tenant_viewer_role_cannot_insert(
        self,
        db: Session,
        postgres_container: PostgresContainer,
        tenant_a: Tenants,
        popup_tenant_a: Popups,
    ) -> None:
        """tenant_viewer_role (READONLY credential) has no INSERT grant on sales_flows."""
        dsn = _get_tenant_dsn(
            db, postgres_container, tenant_a.id, CredentialType.READONLY
        )
        with psycopg.connect(dsn) as conn:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute(
                    "INSERT INTO sales_flows (id, tenant_id, popup_id, slug, name) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    (
                        str(uuid.uuid4()),
                        str(tenant_a.id),
                        str(popup_tenant_a.id),
                        f"flow-viewer-{uuid.uuid4().hex[:8]}",
                        "Viewer Flow",
                    ),
                )
                conn.commit()

    def test_tenant_viewer_role_can_read_own_flow(
        self,
        db: Session,
        postgres_container: PostgresContainer,
        tenant_a: Tenants,
        sales_flow_tenant_a: uuid.UUID,
    ) -> None:
        """tenant_viewer_role can SELECT rows within its own tenant scope."""
        dsn = _get_tenant_dsn(
            db, postgres_container, tenant_a.id, CredentialType.READONLY
        )
        with psycopg.connect(dsn, autocommit=True) as conn:
            row = conn.execute(
                "SELECT id FROM sales_flows WHERE id = %s", (str(sales_flow_tenant_a),)
            ).fetchone()
        assert row is not None
        assert row[0] == sales_flow_tenant_a

    def test_tenant_a_cannot_see_tenant_b_flow(
        self,
        db: Session,
        postgres_container: PostgresContainer,
        tenant_a: Tenants,
        tenant_b: Tenants,
        popup_tenant_b: Popups,
    ) -> None:
        """RLS filters out tenant B's rows from tenant A's session."""
        flow_id = uuid.uuid4()
        _insert_sales_flow_as_owner(
            db,
            flow_id=flow_id,
            tenant_id=popup_tenant_b.tenant_id,
            popup_id=popup_tenant_b.id,
            slug=f"flow-b-{uuid.uuid4().hex[:8]}",
            name="Flow B",
        )

        dsn = _get_tenant_dsn(db, postgres_container, tenant_a.id, CredentialType.CRUD)
        with psycopg.connect(dsn, autocommit=True) as conn:
            row = conn.execute(
                "SELECT id FROM sales_flows WHERE id = %s", (str(flow_id),)
            ).fetchone()
        assert row is None


class TestFlowProductsRLS:
    """RLS coverage for the flow_products link table (task 1.7)."""

    @pytest.fixture()
    def product_tenant_a(self, db: Session, popup_tenant_a: Popups) -> Products:
        suffix = uuid.uuid4().hex[:6]
        product = Products(
            tenant_id=popup_tenant_a.tenant_id,
            popup_id=popup_tenant_a.id,
            name=f"Product A {suffix}",
            slug=f"product-a-{suffix}",
            price=10,
        )
        db.add(product)
        db.commit()
        db.refresh(product)
        assign_to_default_flow(db, product)
        return product

    def test_tenant_role_can_insert_and_read_own_link(
        self,
        db: Session,
        postgres_container: PostgresContainer,
        tenant_a: Tenants,
        sales_flow_tenant_a: uuid.UUID,
        product_tenant_a: Products,
    ) -> None:
        """tenant_role can INSERT and SELECT its own tenant's flow_products row."""
        dsn = _get_tenant_dsn(db, postgres_container, tenant_a.id, CredentialType.CRUD)
        with psycopg.connect(dsn, autocommit=True) as conn:
            conn.execute(
                "INSERT INTO flow_products (tenant_id, flow_id, product_id) "
                "VALUES (%s, %s, %s)",
                (
                    str(tenant_a.id),
                    str(sales_flow_tenant_a),
                    str(product_tenant_a.id),
                ),
            )
            row = conn.execute(
                "SELECT product_id FROM flow_products WHERE flow_id = %s",
                (str(sales_flow_tenant_a),),
            ).fetchone()
        assert row is not None
        assert row[0] == product_tenant_a.id

    def test_tenant_viewer_role_cannot_insert(
        self,
        db: Session,
        postgres_container: PostgresContainer,
        tenant_a: Tenants,
        sales_flow_tenant_a: uuid.UUID,
        product_tenant_a: Products,
    ) -> None:
        """tenant_viewer_role has no INSERT grant on flow_products."""
        dsn = _get_tenant_dsn(
            db, postgres_container, tenant_a.id, CredentialType.READONLY
        )
        with psycopg.connect(dsn) as conn:
            with pytest.raises(psycopg.errors.InsufficientPrivilege):
                conn.execute(
                    "INSERT INTO flow_products (tenant_id, flow_id, product_id) "
                    "VALUES (%s, %s, %s)",
                    (
                        str(tenant_a.id),
                        str(sales_flow_tenant_a),
                        str(product_tenant_a.id),
                    ),
                )
                conn.commit()
