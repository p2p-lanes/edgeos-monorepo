"""The questions a booking asks, and the answers it accepts.

Pure unit tests: no database, because none of this needs one. What is worth
pinning is how tolerantly a stored form is read and the exact order the
answers are checked in, since the portal mirrors the second and a divergence
means a buyer fixes one refusal and walks into another.
"""

import pytest
from pydantic import ValidationError

from app.api.accommodation.guest_form import (
    AccommodationGuestForm,
    GuestFormError,
    normalise_guests,
    parse_form,
    snapshot,
    validate_answers,
)

FULL_NAME = {"key": "full_name", "type": "text", "label": "Full name", "required": True}
AGE = {"key": "age", "type": "number", "label": "Age", "config": {"min": 18}}
EMAIL = {"key": "email", "type": "email", "label": "Email", "required": True}
DIET = {
    "key": "diet",
    "type": "select",
    "label": "Diet",
    "options": ["None", "Vegetarian"],
}

STEP_FORM = {"booker": {"fields": [FULL_NAME, EMAIL]}}


def _form(**sections) -> AccommodationGuestForm:
    return AccommodationGuestForm.model_validate(sections)


# ---------------------------------------------------------------------------
# Reading what the step stored
# ---------------------------------------------------------------------------


class TestParseForm:
    def test_the_step_form_is_what_gets_asked(self) -> None:
        form = parse_form(STEP_FORM)

        assert form is not None
        assert [field.key for field in form.booker.fields] == ["full_name", "email"]

    def test_a_step_with_no_form_asks_nothing(self) -> None:
        assert parse_form(None) is None

    def test_a_form_with_no_fields_is_no_form(self) -> None:
        assert parse_form({"booker": {"fields": []}}) is None

    def test_a_form_that_only_asks_the_guests_still_counts(self) -> None:
        # `asks_nothing` looks at both sections: a step that asks the
        # occupants something and the booker nothing is unusual, not empty.
        form = parse_form(
            {"booker": {"fields": []}, "guests": {"mode": "custom", "fields": [AGE]}}
        )

        assert form is not None
        assert [field.key for field in form.guest_fields()] == ["age"]

    def test_a_stored_form_that_no_longer_parses_does_not_break_the_checkout(
        self,
    ) -> None:
        # Reading is forgiving, writing is not: this row is already in the
        # database, and refusing to sell a room over it helps nobody.
        assert parse_form({"booker": {"fields": [{"nonsense": True}]}}) is None


# ---------------------------------------------------------------------------
# What each guest is asked
# ---------------------------------------------------------------------------


class TestGuestFields:
    def test_same_as_booker_repeats_the_booker_fields(self) -> None:
        form = _form(booker={"fields": [FULL_NAME, AGE]})

        assert [field.key for field in form.guest_fields()] == ["full_name", "age"]

    def test_custom_asks_the_guests_their_own_shorter_list(self) -> None:
        form = _form(
            booker={"fields": [FULL_NAME, EMAIL]},
            guests={"mode": "custom", "fields": [AGE]},
        )

        assert [field.key for field in form.guest_fields()] == ["age"]

    def test_off_asks_the_guests_nothing_while_still_asking_the_booker(self) -> None:
        form = _form(booker={"fields": [FULL_NAME]}, guests={"mode": "off"})

        assert form.guest_fields() == []
        assert not form.asks_nothing()


# ---------------------------------------------------------------------------
# What a form may contain
# ---------------------------------------------------------------------------


class TestFormShape:
    def test_refuses_a_field_type_this_form_cannot_render(self) -> None:
        with pytest.raises(ValidationError, match="not allowed"):
            _form(
                booker={"fields": [{"key": "sig", "type": "signature", "label": "X"}]}
            )

    def test_refuses_two_fields_sharing_a_key(self) -> None:
        # The key is where the answer is stored: duplicates would mean one
        # question silently overwriting the other's answer.
        with pytest.raises(ValidationError, match="unique"):
            _form(booker={"fields": [AGE, {**AGE, "label": "Age again"}]})

    def test_refuses_a_choice_field_with_no_options(self) -> None:
        with pytest.raises(ValidationError, match="needs options"):
            _form(booker={"fields": [{**DIET, "options": []}]})

    def test_refuses_more_fields_than_anyone_would_fill_in(self) -> None:
        many = [{**AGE, "key": f"q{index}"} for index in range(31)]

        with pytest.raises(ValidationError, match="at most"):
            _form(booker={"fields": many})

    def test_a_snapshot_round_trips_into_the_same_form(self) -> None:
        form = _form(booker={"fields": [FULL_NAME, DIET]})

        assert parse_form(snapshot(form)) == form

    def test_no_form_has_no_snapshot(self) -> None:
        assert snapshot(None) is None


# ---------------------------------------------------------------------------
# Whether the answers are acceptable
# ---------------------------------------------------------------------------


class TestValidateAnswers:
    def test_accepts_a_fully_answered_form(self) -> None:
        form = _form(booker={"fields": [FULL_NAME, EMAIL]}, guests={"mode": "off"})

        validate_answers(form, {"full_name": "Ada", "email": "ada@example.com"}, [])

    def test_names_the_field_a_required_answer_is_missing_from(self) -> None:
        form = _form(booker={"fields": [FULL_NAME, EMAIL]}, guests={"mode": "off"})

        with pytest.raises(GuestFormError) as caught:
            validate_answers(form, {"full_name": "Ada"}, [])

        assert caught.value.key == "email"
        assert caught.value.guest_index is None
        assert caught.value.message == "Email is required"

    def test_whitespace_is_not_an_answer(self) -> None:
        form = _form(booker={"fields": [FULL_NAME]}, guests={"mode": "off"})

        with pytest.raises(GuestFormError):
            validate_answers(form, {"full_name": "   "}, [])

    def test_an_optional_field_left_blank_is_fine(self) -> None:
        form = _form(booker={"fields": [AGE]}, guests={"mode": "off"})

        validate_answers(form, {}, [])

    def test_refuses_something_that_is_not_an_email(self) -> None:
        form = _form(booker={"fields": [EMAIL]}, guests={"mode": "off"})

        with pytest.raises(GuestFormError, match="does not look like an email"):
            validate_answers(form, {"email": "ada at example"}, [])

    def test_refuses_a_choice_that_was_never_offered(self) -> None:
        form = _form(booker={"fields": [DIET]}, guests={"mode": "off"})

        with pytest.raises(GuestFormError, match="pick one"):
            validate_answers(form, {"diet": "Carnivore"}, [])

    def test_refuses_a_number_below_the_configured_minimum(self) -> None:
        form = _form(booker={"fields": [AGE]}, guests={"mode": "off"})

        with pytest.raises(GuestFormError, match="18 or more"):
            validate_answers(form, {"age": 12}, [])

    def test_a_required_consent_must_be_ticked_not_merely_present(self) -> None:
        consent = {
            "key": "terms",
            "type": "boolean",
            "label": "Terms",
            "required": True,
        }
        form = _form(booker={"fields": [consent]}, guests={"mode": "off"})

        with pytest.raises(GuestFormError, match="Terms is required"):
            validate_answers(form, {"terms": False}, [])
        validate_answers(form, {"terms": True}, [])

    def test_points_at_the_guest_whose_answer_is_missing(self) -> None:
        form = _form(booker={"fields": [FULL_NAME]})

        with pytest.raises(GuestFormError) as caught:
            validate_answers(
                form,
                {"full_name": "Ada"},
                [
                    {"name": "Grace", "answers": {"full_name": "Grace"}},
                    {"name": "Alan", "answers": {}},
                ],
            )

        assert caught.value.guest_index == 1
        assert caught.value.key == "full_name"

    def test_checks_the_booker_before_the_guests(self) -> None:
        # The order is the buyer's reading order. Reporting a guest's missing
        # answer while the booker's is also missing sends them past the first
        # thing they have to fix.
        form = _form(booker={"fields": [FULL_NAME]})

        with pytest.raises(GuestFormError) as caught:
            validate_answers(form, {}, [{"name": "", "answers": {}}])

        assert caught.value.guest_index is None

    def test_answers_to_questions_the_form_no_longer_asks_are_ignored(self) -> None:
        # A cart filled in before a field was removed still has to be payable.
        form = _form(booker={"fields": [FULL_NAME]}, guests={"mode": "off"})

        validate_answers(form, {"full_name": "Ada", "retired_question": "x"}, [])

    def test_no_form_accepts_anything(self) -> None:
        validate_answers(None, {}, [{"name": "Ada"}])


# ---------------------------------------------------------------------------
# The shape guests arrive in
# ---------------------------------------------------------------------------


class TestNormaliseGuests:
    def test_reads_the_bare_names_carts_used_before_this_existed(self) -> None:
        assert normalise_guests(["Ada", "Grace"]) == [
            {"name": "Ada", "answers": {}},
            {"name": "Grace", "answers": {}},
        ]

    def test_keeps_answers_alongside_the_name(self) -> None:
        raw = [{"name": "Ada", "answers": {"age": 36}}]

        assert normalise_guests(raw) == raw

    def test_drops_the_empty_slots_the_checkout_renders(self) -> None:
        assert normalise_guests([{"name": "Ada"}, {"name": ""}, {}]) == [
            {"name": "Ada", "answers": {}}
        ]

    def test_keeps_a_guest_who_answered_but_has_no_name_yet(self) -> None:
        # `require_guest_names` decides whether that is acceptable; throwing
        # the answers away here would decide it silently and lose data.
        assert normalise_guests([{"answers": {"age": 36}}]) == [
            {"name": "", "answers": {"age": 36}}
        ]

    def test_survives_nonsense(self) -> None:
        assert normalise_guests(None) == []
        assert normalise_guests([None, 7]) == []
