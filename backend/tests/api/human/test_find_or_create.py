"""Tests for HumansCRUD.find_or_create — CAP-E.

TDD phase: RED — tests written BEFORE implementation.
The method does not exist yet; all tests must FAIL initially.

Scenarios:
1. New email creates Human row
2. Existing email returns unchanged row (no overwrite)
3. Cross-tenant isolation creates second row
4. Concurrent calls (5 threads) converge to single row
"""

import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed

from sqlmodel import Session, select

from app.api.human.crud import humans_crud
from app.api.human.models import Humans
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _unique_email(prefix: str = "foc") -> str:
    return f"{prefix}-{uuid.uuid4().hex[:8]}@test.com"


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_find_or_create_new_email_creates_human(db: Session, tenant_a: Tenants) -> None:
    """New email + tenant creates a Humans row and returns it."""
    email = _unique_email("new")

    result = humans_crud.find_or_create(
        db,
        email=email,
        tenant_id=tenant_a.id,
        default_first_name="Matias",
        default_last_name="Walter",
    )

    assert result.id is not None
    assert result.email == email
    assert result.tenant_id == tenant_a.id
    assert result.first_name == "Matias"
    assert result.last_name == "Walter"

    # Verify it's actually in DB
    db_row = db.exec(
        select(Humans).where(Humans.email == email, Humans.tenant_id == tenant_a.id)
    ).first()
    assert db_row is not None
    assert db_row.id == result.id


def test_find_or_create_existing_email_returns_unchanged(
    db: Session, tenant_a: Tenants
) -> None:
    """Existing Human for (email, tenant) is returned without overwriting fields."""
    email = _unique_email("existing")

    # Pre-create human with known first_name
    existing = Humans(
        id=uuid.uuid4(),
        tenant_id=tenant_a.id,
        email=email,
        first_name="Original",
        last_name="Name",
    )
    db.add(existing)
    db.commit()
    db.refresh(existing)

    # Now call find_or_create with a different first_name
    result = humans_crud.find_or_create(
        db,
        email=email,
        tenant_id=tenant_a.id,
        default_first_name="Overwrite Attempt",
        default_last_name="Should Not Happen",
    )

    # Must return the same row
    assert result.id == existing.id
    assert result.first_name == "Original"
    assert result.last_name == "Name"

    # Verify DB still has original
    db.expire(existing)
    db.refresh(existing)
    assert existing.first_name == "Original"


def test_find_or_create_cross_tenant_isolation(
    db: Session, tenant_a: Tenants, tenant_b: Tenants
) -> None:
    """Same email in different tenants creates independent rows."""
    email = _unique_email("cross")

    human_a = humans_crud.find_or_create(
        db, email=email, tenant_id=tenant_a.id, default_first_name="A"
    )
    human_b = humans_crud.find_or_create(
        db, email=email, tenant_id=tenant_b.id, default_first_name="B"
    )

    assert human_a.id != human_b.id
    assert human_a.tenant_id == tenant_a.id
    assert human_b.tenant_id == tenant_b.id

    rows = db.exec(select(Humans).where(Humans.email == email)).all()
    assert len(rows) == 2


def test_find_or_create_concurrent_calls_converge(
    test_connection_url: str, tenant_a: Tenants
) -> None:
    """5 concurrent find_or_create calls with same (email, tenant) → exactly 1 row."""
    from sqlmodel import create_engine

    email = _unique_email("race")
    tenant_id = tenant_a.id

    def call_find_or_create() -> uuid.UUID:
        engine = create_engine(test_connection_url)
        with Session(engine) as sess:
            human = humans_crud.find_or_create(
                sess, email=email, tenant_id=tenant_id, default_first_name="Race"
            )
            return human.id

    with ThreadPoolExecutor(max_workers=5) as executor:
        futures = [executor.submit(call_find_or_create) for _ in range(5)]
        results = [f.result() for f in as_completed(futures)]

    # All 5 must return the same id
    assert len(set(results)) == 1, (
        f"Expected 1 unique id, got {len(set(results))}: {results}"
    )

    # DB must have exactly 1 row for this email+tenant
    engine = create_engine(test_connection_url)
    with Session(engine) as sess:
        rows = list(
            sess.exec(
                select(Humans).where(
                    Humans.email == email, Humans.tenant_id == tenant_id
                )
            ).all()
        )
    assert len(rows) == 1
