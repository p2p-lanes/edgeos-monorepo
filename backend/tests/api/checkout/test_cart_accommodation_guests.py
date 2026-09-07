"""Guests in a saved cart.

Guests used to travel as bare names. Carts are persisted JSONB and are
restored days later, so the older shape is not a migration question with an
end date: it is an input this schema has to keep accepting, or reopening a
checkout answers 422 and the buyer loses everything they typed.
"""

from app.api.cart.schemas import CartItemAccommodation, CartState

STAY = {
    "accommodation_id": "0b2b7c9a-6c2a-4d5f-9a1e-8c1f2d3e4a5b",
    "check_in": "2026-09-14",
    "check_out": "2026-09-18",
    "guest_count": 2,
}


def test_a_cart_saved_before_guests_had_answers_still_loads() -> None:
    item = CartItemAccommodation.model_validate({**STAY, "guests": ["Ada", "Grace"]})

    assert [guest.name for guest in item.guests] == ["Ada", "Grace"]
    assert all(guest.answers == {} for guest in item.guests)
    assert item.booker_answers == {}


def test_a_cart_with_answers_round_trips() -> None:
    raw = {
        **STAY,
        "guests": [{"name": "Ada", "answers": {"age": 36}}, {"name": "Grace"}],
        "booker_answers": {"full_name": "Ada Lovelace"},
    }

    item = CartItemAccommodation.model_validate(raw)

    assert item.guests[0].answers == {"age": 36}
    assert item.guests[1].answers == {}
    assert item.booker_answers == {"full_name": "Ada Lovelace"}


def test_a_guest_slot_may_be_empty_while_the_party_is_typed_in() -> None:
    """The checkout renders one slot per guest before any is filled in, and
    saving half a party is what a saved cart is for."""
    item = CartItemAccommodation.model_validate({**STAY, "guests": [{"name": ""}, {}]})

    assert [guest.name for guest in item.guests] == ["", ""]


def test_the_whole_cart_state_accepts_the_older_shape() -> None:
    state = CartState.model_validate(
        {"accommodations": [{**STAY, "guests": ["Ada"]}, {**STAY, "guests": []}]}
    )

    assert state.accommodations[0].guests[0].name == "Ada"
    assert state.accommodations[1].guests == []
