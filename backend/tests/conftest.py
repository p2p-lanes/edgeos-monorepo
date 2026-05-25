import uuid
from collections.abc import Generator
from unittest.mock import patch

import pytest
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient
from sqlmodel import Session, create_engine, select
from testcontainers.postgres import PostgresContainer

from app.api.api_key import crud as api_key_crud
from app.api.api_key.models import ApiKeys
from app.api.human.models import Humans
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupStatus
from app.api.shared.enums import SaleType, UserRole
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.dependencies.users import get_session
from app.core.security import (
    THIRD_PARTY_TOKEN_SCOPES_MAX,
    create_access_token,
)
from app.core.tenant_db import ensure_tenant_credentials, tenant_connection_manager
from app.main import application


@pytest.fixture(scope="session")
def postgres_container() -> Generator[PostgresContainer, None, None]:
    with PostgresContainer(
        image="postgres:17",
        username="test_user",
        password="test_password",
        dbname="test_db",
        driver="psycopg",
    ) as postgres:
        yield postgres


@pytest.fixture(scope="session")
def test_connection_url(postgres_container: PostgresContainer) -> str:
    return postgres_container.get_connection_url()


@pytest.fixture(scope="session")
def test_engine(test_connection_url: str):
    engine = create_engine(test_connection_url)

    with engine.begin() as connection:
        alembic_cfg = Config("alembic.ini")
        alembic_cfg.attributes["connection"] = connection
        command.upgrade(alembic_cfg, "head")

    return engine


@pytest.fixture(scope="session")
def db(test_engine) -> Generator[Session, None, None]:
    with Session(test_engine) as session:
        yield session


@pytest.fixture(scope="session")
def client(
    test_engine,
    postgres_container: PostgresContainer,
) -> Generator[TestClient, None, None]:
    def get_test_session() -> Generator[Session, None, None]:
        with Session(test_engine) as session:
            yield session

    host = postgres_container.get_container_host_ip()
    port = int(postgres_container.get_exposed_port(5432))

    application.dependency_overrides[get_session] = get_test_session
    tenant_connection_manager._engines.clear()

    with (
        patch("app.core.tenant_db.settings.POSTGRES_SERVER", host),
        patch("app.core.tenant_db.settings.POSTGRES_PORT", port),
        patch("app.core.tenant_db.settings.POSTGRES_DB", "test_db"),
        patch("app.core.tenant_db.settings.POSTGRES_SSL_MODE", "disable"),
        patch("app.core.dependencies.users.engine", test_engine),
        # PAT auth bypasses get_session and resolves the key on the global
        # engine in app.core.security; patch that bind to the testcontainer
        # so test_api_key_policy.py doesn't hit a real localhost Postgres.
        patch("app.core.security.engine", test_engine),
        # check_in router resolves actor user details via the main engine
        # (tenant_role lacks SELECT on users); same testcontainer redirection
        # needed so the list endpoint works without a real localhost Postgres.
        patch("app.api.check_in.router.engine", test_engine),
    ):
        with TestClient(application) as c:
            yield c

    tenant_connection_manager._engines.clear()
    application.dependency_overrides.clear()


@pytest.fixture(scope="session")
def superadmin_user(db: Session) -> Users:
    user = db.exec(
        select(Users).where(
            Users.role == UserRole.SUPERADMIN,
            Users.deleted == False,  # noqa: E712
        )
    ).first()

    if user is None:
        user = Users(
            email=f"superadmin-{uuid.uuid4().hex[:8]}@test.com",
            role=UserRole.SUPERADMIN,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return user


@pytest.fixture(scope="session")
def superadmin_token(superadmin_user: Users) -> str:
    return create_access_token(subject=superadmin_user.id, token_type="user")


@pytest.fixture(scope="session")
def tenant_a(db: Session) -> Tenants:
    tenant = db.exec(select(Tenants).where(Tenants.slug == "test-tenant-a")).first()

    if tenant is None:
        tenant = Tenants(
            name="Test Tenant A",
            slug="test-tenant-a",
        )
        db.add(tenant)
        db.commit()
        db.refresh(tenant)
        ensure_tenant_credentials(db, tenant.id)

    return tenant


@pytest.fixture(scope="session")
def tenant_b(db: Session) -> Tenants:
    tenant = db.exec(select(Tenants).where(Tenants.slug == "test-tenant-b")).first()

    if tenant is None:
        tenant = Tenants(
            name="Test Tenant B",
            slug="test-tenant-b",
        )
        db.add(tenant)
        db.commit()
        db.refresh(tenant)
        ensure_tenant_credentials(db, tenant.id)

    return tenant


@pytest.fixture(scope="session")
def admin_user_tenant_a(db: Session, tenant_a: Tenants) -> Users:
    user = db.exec(
        select(Users).where(
            Users.email == "admin-a@test.com",
            Users.deleted == False,  # noqa: E712
        )
    ).first()

    if user is None:
        user = Users(
            email="admin-a@test.com",
            role=UserRole.ADMIN,
            tenant_id=tenant_a.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return user


@pytest.fixture(scope="session")
def admin_user_tenant_b(db: Session, tenant_b: Tenants) -> Users:
    user = db.exec(
        select(Users).where(
            Users.email == "admin-b@test.com",
            Users.deleted == False,  # noqa: E712
        )
    ).first()

    if user is None:
        user = Users(
            email="admin-b@test.com",
            role=UserRole.ADMIN,
            tenant_id=tenant_b.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return user


@pytest.fixture(scope="session")
def viewer_user_tenant_a(db: Session, tenant_a: Tenants) -> Users:
    user = db.exec(
        select(Users).where(
            Users.email == "viewer-a@test.com",
            Users.deleted == False,  # noqa: E712
        )
    ).first()

    if user is None:
        user = Users(
            email="viewer-a@test.com",
            role=UserRole.VIEWER,
            tenant_id=tenant_a.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return user


@pytest.fixture(scope="session")
def admin_token_tenant_a(admin_user_tenant_a: Users) -> str:
    return create_access_token(subject=admin_user_tenant_a.id, token_type="user")


@pytest.fixture(scope="session")
def admin_token_tenant_b(admin_user_tenant_b: Users) -> str:
    return create_access_token(subject=admin_user_tenant_b.id, token_type="user")


@pytest.fixture(scope="session")
def operator_user_tenant_a(db: Session, tenant_a: Tenants) -> Users:
    user = db.exec(
        select(Users).where(
            Users.email == "operator-a@test.com",
            Users.deleted == False,  # noqa: E712
        )
    ).first()

    if user is None:
        user = Users(
            email="operator-a@test.com",
            role=UserRole.OPERATOR,
            tenant_id=tenant_a.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return user


@pytest.fixture(scope="session")
def operator_user_tenant_b(db: Session, tenant_b: Tenants) -> Users:
    user = db.exec(
        select(Users).where(
            Users.email == "operator-b@test.com",
            Users.deleted == False,  # noqa: E712
        )
    ).first()

    if user is None:
        user = Users(
            email="operator-b@test.com",
            role=UserRole.OPERATOR,
            tenant_id=tenant_b.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return user


@pytest.fixture(scope="session")
def operator_token_tenant_a(operator_user_tenant_a: Users) -> str:
    return create_access_token(subject=operator_user_tenant_a.id, token_type="user")


@pytest.fixture(scope="session")
def operator_token_tenant_b(operator_user_tenant_b: Users) -> str:
    return create_access_token(subject=operator_user_tenant_b.id, token_type="user")


@pytest.fixture(scope="session")
def viewer_user_tenant_b(db: Session, tenant_b: Tenants) -> Users:
    user = db.exec(
        select(Users).where(
            Users.email == "viewer-b@test.com",
            Users.deleted == False,  # noqa: E712
        )
    ).first()

    if user is None:
        user = Users(
            email="viewer-b@test.com",
            role=UserRole.VIEWER,
            tenant_id=tenant_b.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return user


@pytest.fixture(scope="session")
def viewer_token_tenant_a(viewer_user_tenant_a: Users) -> str:
    return create_access_token(subject=viewer_user_tenant_a.id, token_type="user")


@pytest.fixture(scope="session")
def viewer_token_tenant_b(viewer_user_tenant_b: Users) -> str:
    return create_access_token(subject=viewer_user_tenant_b.id, token_type="user")


@pytest.fixture(scope="session")
def check_in_controller_user_tenant_a(db: Session, tenant_a: Tenants) -> Users:
    user = db.exec(
        select(Users).where(
            Users.email == "controller-a@test.com",
            Users.deleted == False,  # noqa: E712
        )
    ).first()

    if user is None:
        user = Users(
            email="controller-a@test.com",
            role=UserRole.CHECK_IN_CONTROLLER,
            tenant_id=tenant_a.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return user


@pytest.fixture(scope="session")
def check_in_controller_user_tenant_b(db: Session, tenant_b: Tenants) -> Users:
    user = db.exec(
        select(Users).where(
            Users.email == "controller-b@test.com",
            Users.deleted == False,  # noqa: E712
        )
    ).first()

    if user is None:
        user = Users(
            email="controller-b@test.com",
            role=UserRole.CHECK_IN_CONTROLLER,
            tenant_id=tenant_b.id,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    return user


@pytest.fixture(scope="session")
def check_in_controller_token_tenant_a(check_in_controller_user_tenant_a: Users) -> str:
    return create_access_token(
        subject=check_in_controller_user_tenant_a.id, token_type="user"
    )


@pytest.fixture(scope="session")
def check_in_controller_token_tenant_b(check_in_controller_user_tenant_b: Users) -> str:
    return create_access_token(
        subject=check_in_controller_user_tenant_b.id, token_type="user"
    )


@pytest.fixture(scope="session")
def popup_tenant_a(db: Session, tenant_a: Tenants) -> Popups:
    popup = db.exec(select(Popups).where(Popups.slug == "popup-tenant-a")).first()

    if popup is None:
        popup = Popups(
            name="Popup Tenant A",
            slug="popup-tenant-a",
            tenant_id=tenant_a.id,
        )
        db.add(popup)
        db.commit()
        db.refresh(popup)

    return popup


@pytest.fixture(scope="session")
def popup_tenant_b(db: Session, tenant_b: Tenants) -> Popups:
    popup = db.exec(select(Popups).where(Popups.slug == "popup-tenant-b")).first()

    if popup is None:
        popup = Popups(
            name="Popup Tenant B",
            slug="popup-tenant-b",
            tenant_id=tenant_b.id,
        )
        db.add(popup)
        db.commit()
        db.refresh(popup)

    return popup


@pytest.fixture(scope="session")
def popup_tenant_a_summer_fest(db: Session, tenant_a: Tenants) -> Popups:
    popup = db.exec(
        select(Popups).where(
            Popups.slug == "summer-fest",
            Popups.tenant_id == tenant_a.id,
        )
    ).first()
    if popup is None:
        popup = Popups(
            name="Summer Fest A",
            slug="summer-fest",
            tenant_id=tenant_a.id,
            sale_type=SaleType.direct,
            status=PopupStatus.active,
        )
        db.add(popup)
        db.commit()
        db.refresh(popup)
    return popup


@pytest.fixture(scope="session")
def popup_tenant_b_summer_fest(db: Session, tenant_b: Tenants) -> Popups:
    popup = db.exec(
        select(Popups).where(
            Popups.slug == "summer-fest",
            Popups.tenant_id == tenant_b.id,
        )
    ).first()
    if popup is None:
        popup = Popups(
            name="Summer Fest B",
            slug="summer-fest",
            tenant_id=tenant_b.id,
            sale_type=SaleType.direct,
            status=PopupStatus.active,
        )
        db.add(popup)
        db.commit()
        db.refresh(popup)
    return popup


def with_origin(host: str) -> dict[str, str]:
    """Return a headers dict with an Origin pointing at the given host."""
    return {"Origin": f"https://{host}"}


# ---------------------------------------------------------------------------
# Block F — Fixtures for dual-owner api keys and scope variations
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def third_party_enabled_tenant(db: Session, tenant_a: Tenants):
    """tenant_a pre-configured with a ThirdPartyApps 'legacy' row.

    Returns (tenant, app, raw_key) so tests can verify key validation,
    app lookup, and prefix display.

    The raw_key is deterministic so multiple tests can share the same
    session-scoped fixture without re-hashing.
    """
    from app.api.third_party_app.models import ThirdPartyApps

    raw_key = "tp_test_secret_key_for_tests_only"
    key_hash = api_key_crud.hash_key(raw_key)

    # Check if the legacy app row already exists (idempotent fixture).
    from sqlmodel import select

    app = db.exec(
        select(ThirdPartyApps).where(
            ThirdPartyApps.tenant_id == tenant_a.id,
            ThirdPartyApps.name == "legacy",
            ThirdPartyApps.key_hash == key_hash,
        )
    ).first()

    if app is None:
        app = ThirdPartyApps(
            tenant_id=tenant_a.id,
            name="legacy",
            key_hash=key_hash,
            prefix=raw_key[:8],
            allowed_token_scopes=list(THIRD_PARTY_TOKEN_SCOPES_MAX),
            allowed_api_key_scopes=["events:read", "rsvp:write"],
            active=True,
        )
        db.add(app)
        db.commit()
        db.refresh(app)

    return tenant_a, app, raw_key


@pytest.fixture()
def admin_api_key_factory(db: Session, tenant_a: Tenants, admin_user_tenant_a: Users):
    """Factory fixture: creates an admin-owned ApiKeys row for the test admin user.

    Usage::

        def test_something(admin_api_key_factory):
            row, raw = admin_api_key_factory(scopes=["events:read"])
    """

    created_ids: list[uuid.UUID] = []

    def _factory(scopes: list[str]) -> tuple[ApiKeys, str]:
        raw = api_key_crud.generate_raw_key()
        row = ApiKeys(
            tenant_id=tenant_a.id,
            human_id=None,
            user_id=admin_user_tenant_a.id,
            name=f"admin-key-{uuid.uuid4().hex[:6]}",
            key_hash=api_key_crud.hash_key(raw),
            prefix=api_key_crud.display_prefix(raw),
            scopes=scopes,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
        created_ids.append(row.id)
        return row, raw

    yield _factory

    # Cleanup after test
    for key_id in created_ids:
        row = db.get(ApiKeys, key_id)
        if row:
            db.delete(row)
    db.commit()


@pytest.fixture()
def third_party_jwt_factory():
    """Factory fixture: mints a third-party JWT directly via create_access_token.

    Usage::

        def test_something(third_party_jwt_factory, some_human):
            token = third_party_jwt_factory(human=some_human)
            # or with custom scopes:
            token = third_party_jwt_factory(human=some_human, scopes=["portal:applications:read"])
    """

    def _factory(
        human: Humans,
        scopes: list[str] | None = None,
    ) -> str:
        return create_access_token(
            subject=human.id,
            token_type="human",
            scopes=scopes if scopes is not None else list(THIRD_PARTY_TOKEN_SCOPES_MAX),
            issued_via="third_party",
        )

    return _factory


@pytest.fixture(autouse=True)
def _scrub_patron_state(db: Session) -> Generator[None, None, None]:
    """Reset patron singletons between tests.

    Why: the partial unique indexes from `patron-product-rules` allow at most one
    active patreon product and one enabled patron-preset ticketing step per popup.
    The session-scoped `db` fixture means tests share a single SQLAlchemy session,
    so a patron row created by one test would otherwise collide with the next test
    that uses the same shared popup.
    """
    from datetime import UTC, datetime

    from sqlalchemy import update

    from app.api.product.models import Products
    from app.api.ticketing_step.models import TicketingSteps

    yield

    try:
        db.rollback()
    except Exception:
        pass

    db.exec(
        update(Products)
        .where(Products.category == "patreon", Products.deleted_at.is_(None))
        .values(deleted_at=datetime.now(UTC))
    )
    db.exec(
        update(TicketingSteps)
        .where(
            TicketingSteps.template == "patron-preset",
            TicketingSteps.is_enabled.is_(True),
        )
        .values(is_enabled=False)
    )
    db.commit()
