"""Guests in a saved cart.

Guests used to travel as bare names, and before the canonical lines landed
they travelled under a top-level ``accommodations`` key. Carts are persisted
JSONB restored days later, so neither older shape is a migration with an end
date: both are inputs this schema has to keep accepting, or reopening a
checkout answers 422 and the buyer loses everything they typed.
"""

from app.api.cart._migration import migrate_cart_state
from app.api.cart.schemas import CartAccommodationLine, CartState

STAY = {
    "kind": "accommodation",
    "assignment": {"kind": "unassigned"},
    "accommodation_id": "0b2b7c9a-6c2a-4d5f-9a1e-8c1f2d3e4a5b",
    "check_in": "2026-09-14",
    "check_out": "2026-09-18",
    "guest_count": 2,
}


def test_a_line_saved_before_guests_had_answers_still_loads() -> None:
    line = CartAccommodationLine.model_validate({**STAY, "guests": ["Ada", "Grace"]})

    assert [guest.name for guest in line.guests] == ["Ada", "Grace"]
    assert all(guest.answers == {} for guest in line.guests)
    assert line.booker_answers == {}


def test_a_line_with_answers_round_trips() -> None:
    raw = {
        **STAY,
        "guests": [{"name": "Ada", "answers": {"age": 36}}, {"name": "Grace"}],
        "booker_answers": {"full_name": "Ada Lovelace"},
    }

    line = CartAccommodationLine.model_validate(raw)

    assert line.guests[0].answers == {"age": 36}
    assert line.guests[1].answers == {}
    assert line.booker_answers == {"full_name": "Ada Lovelace"}


def test_a_guest_slot_may_be_empty_while_the_party_is_typed_in() -> None:
    """The checkout renders one slot per guest before any is filled in, and
    saving half a party is what a saved cart is for."""
    line = CartAccommodationLine.model_validate({**STAY, "guests": [{"name": ""}, {}]})

    assert [guest.name for guest in line.guests] == ["", ""]


def test_the_whole_cart_state_accepts_the_older_guest_shape() -> None:
    state = CartState.model_validate(
        {"lines": [{**STAY, "guests": ["Ada"]}, {**STAY, "guests": []}]}
    )

    assert state.lines[0].guests[0].name == "Ada"
    assert state.lines[1].guests == []


def test_a_legacy_cart_carries_its_guests_across_the_line_migration() -> None:
    """Two older shapes at once: the pre-canonical ``accommodations`` key
    holding guests as bare names. Both are what a cart saved before either
    change looks like."""
    state, was_legacy = migrate_cart_state(
        {
            "accommodations": [
                {
                    "accommodation_id": STAY["accommodation_id"],
                    "check_in": "2026-09-14",
                    "check_out": "2026-09-18",
                    "guest_count": 2,
                    "guests": ["Ada", "Grace"],
                }
            ]
        }
    )

    assert was_legacy is True
    assert [line.kind for line in state.lines] == ["accommodation"]
    assert [guest.name for guest in state.lines[0].guests] == ["Ada", "Grace"]
    assert state.lines[0].booker_answers == {}

    canonical, was_legacy = migrate_cart_state(state.model_dump(mode="json"))
    assert was_legacy is False
    assert canonical == state


def test_the_line_migration_keeps_answers_it_finds() -> None:
    """A cart saved after the guest form landed but before the canonical
    lines did carries both, and neither half should be dropped."""
    state, _ = migrate_cart_state(
        {
            "accommodations": [
                {
                    "accommodation_id": STAY["accommodation_id"],
                    "check_in": "2026-09-14",
                    "check_out": "2026-09-18",
                    "guests": [{"name": "Ada", "answers": {"age": 36}}],
                    "booker_answers": {"full_name": "Ada Lovelace"},
                }
            ]
        }
    )

    assert state.lines[0].guests[0].answers == {"age": 36}
    assert state.lines[0].booker_answers == {"full_name": "Ada Lovelace"}
