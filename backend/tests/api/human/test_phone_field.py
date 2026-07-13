"""The human schemas expose the WhatsApp phone fields (phone + phone_country)."""

import uuid

from app.api.human.schemas import HumanCreate, HumanPublic, HumanUpdate


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
