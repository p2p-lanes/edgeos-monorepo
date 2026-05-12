"""Migration test: verify landing_mode column defaults to 'portal' (Task 5.5).

Covers scenario AC-T1, AC-T2: all rows have landing_mode='portal' after the migration.

The conftest runs alembic upgrade head at session start — the test
exercises the DB state after migration, confirming the server_default is correct.
"""

from sqlmodel import Session, select

from app.api.shared.enums import LandingMode
from app.api.tenant.models import Tenants


def test_existing_tenant_rows_have_portal_landing_mode(db: Session, tenant_a: Tenants, tenant_b: Tenants) -> None:
    """AC-T2: All existing tenant rows default to landing_mode='portal' after migration."""
    # tenant_a and tenant_b are created by the conftest without setting landing_mode.
    # After migration, their landing_mode must be 'portal'.
    db.refresh(tenant_a)
    db.refresh(tenant_b)

    assert tenant_a.landing_mode == LandingMode.portal, (
        f"tenant_a.landing_mode should be 'portal', got {tenant_a.landing_mode!r}"
    )
    assert tenant_b.landing_mode == LandingMode.portal, (
        f"tenant_b.landing_mode should be 'portal', got {tenant_b.landing_mode!r}"
    )


def test_new_tenant_without_landing_mode_gets_portal_default(db: Session) -> None:
    """AC-T2: Newly inserted tenant without explicit landing_mode gets 'portal'."""
    import uuid

    t = Tenants(
        name=f"Migration Test Tenant {uuid.uuid4().hex[:6]}",
        slug=f"migration-test-{uuid.uuid4().hex[:6]}",
        # intentionally no landing_mode set
    )
    db.add(t)
    db.commit()
    db.refresh(t)

    assert t.landing_mode == LandingMode.portal

    # Cleanup
    db.delete(t)
    db.commit()


def test_all_existing_tenants_have_portal_mode(db: Session) -> None:
    """AC-T2: Bulk check — no tenant row has a non-portal landing_mode after migration."""
    all_tenants = list(db.exec(select(Tenants).where(Tenants.deleted == False)).all())  # noqa: E712

    non_portal = [t for t in all_tenants if t.landing_mode != LandingMode.portal]
    assert non_portal == [], (
        f"Found {len(non_portal)} tenant(s) with landing_mode != 'portal': "
        + ", ".join(f"{t.slug}={t.landing_mode!r}" for t in non_portal)
    )
