"""The human schemas expose the WhatsApp phone fields (phone + phone_country)."""

import uuid

from sqlmodel import Session

from app.api.human.crud import humans_crud
from app.api.human.schemas import HumanCreate, HumanPublic, HumanUpdate
from app.api.tenant.models import Tenants


def test_human_public_exposes_phone_fields() -> None:
    hp = HumanPublic(
        id=uuid.uuid4(),
        tenant_id=uuid.uuid4(),
        email="buyer@test.com",
        phone="1122334455",
        phone_country="AR",
    )
    assert hp.phone == "1122334455"
    assert hp.phone_country == "AR"


def test_human_public_phone_defaults_to_none() -> None:
    hp = HumanPublic(id=uuid.uuid4(), tenant_id=uuid.uuid4(), email="buyer@test.com")
    assert hp.phone is None
    assert hp.phone_country is None


def test_human_create_and_update_accept_phone() -> None:
    created = HumanCreate(
        email="buyer@test.com", phone="1122334455", phone_country="AR"
    )
    assert created.phone == "1122334455"
    assert created.phone_country == "AR"

    updated = HumanUpdate(phone="1199887766", phone_country="BR")
    assert updated.phone == "1199887766"
    assert updated.phone_country == "BR"


def test_find_or_create_writes_phone_on_new_human(
    db: Session, tenant_a: Tenants
) -> None:
    human = humans_crud.find_or_create(
        db,
        email="new-buyer@test.com",
        tenant_id=tenant_a.id,
        default_first_name="Ana",
        default_last_name="Diaz",
        default_phone="1122334455",
        default_phone_country="AR",
    )
    assert human.phone == "1122334455"
    assert human.phone_country == "AR"


def test_find_or_create_does_not_overwrite_existing_phone(
    db: Session, tenant_a: Tenants
) -> None:
    first = humans_crud.find_or_create(
        db,
        email="returning@test.com",
        tenant_id=tenant_a.id,
        default_phone="1111111111",
        default_phone_country="AR",
    )
    db.flush()
    second = humans_crud.find_or_create(
        db,
        email="returning@test.com",
        tenant_id=tenant_a.id,
        default_phone="9999999999",
        default_phone_country="BR",
    )
    assert second.id == first.id
    # Existing row is never overwritten.
    assert second.phone == "1111111111"
    assert second.phone_country == "AR"
