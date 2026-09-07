"""What a booking asks of its guests, and whether the answers are acceptable.

Two questions, deliberately answered in two different places:

    the step   -> *what* is asked (``template_config.guest_form``)
    a property -> *whether it is asked here* (``guest_form_mode``, and its
                  own form when it overrides)

The step owns one form for the whole checkout so an operator configures it
once. A property that needs something different (the hotel that wants a
passport number when the campsite does not) overrides it; a property that
should ask nothing turns it off. ``inherit`` is the default so a step's form
works the moment it is saved, without visiting every property.

Inside a form there are two sections. ``booker`` is asked once per room, of
whoever the room is for. ``guests`` is asked once per additional occupant,
and its ``mode`` is what keeps the common case cheap: ``same_as_booker``
repeats the booker's fields without duplicating the list, ``custom`` asks
something shorter, ``off`` asks nothing.

The guest's *name* is not a field here. It is a column on the booking, it is
what the property owner needs for their own registry, and it is governed by
the step's ``require_guest_names``. Making it configurable would mean a form
could be saved that leaves a property unable to tell one guest from another.
"""

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, model_validator

#: Field types a guest form may use. A subset of ``FormFieldType``: what is
#: missing is missing on purpose. ``signature`` and ``image_upload`` need an
#: upload target and a viewer that does not exist on this path yet, and
#: ``select_cards`` / ``multiselect_detailed`` are merchandising controls, not
#: questions. ``rich_text`` earns its place as the consent checkbox.
GUEST_FORM_FIELD_TYPES: frozenset[str] = frozenset(
    {
        "text",
        "textarea",
        "number",
        "boolean",
        "select",
        "radio",
        "multiselect",
        "date",
        "email",
        "url",
        "phone",
        "country_select",
        "rich_text",
    }
)

#: Types whose answer must be one of ``options``.
_CHOICE_TYPES = frozenset({"select", "radio"})

#: The most fields one section may carry. Not a technical limit: a checkout
#: that asks thirty questions per guest does not get filled in, and a typo in
#: an import should not become a wall of inputs.
MAX_FIELDS_PER_SECTION = 30

GuestFormMode = Literal["inherit", "off", "custom"]


class GuestFormField(BaseModel):
    """One question.

    Mirrors ``FormFieldSchema`` in ``@edgeos/shared-form-ui`` so the portal
    renders it with the same component as every other form, plus ``key``:
    the slug the answer is stored under. The key is generated from the label
    when the field is created and then frozen, so renaming a question does
    not orphan the answers already collected under it.
    """

    key: str
    type: str = "text"
    label: str
    required: bool = False
    placeholder: str | None = None
    help_text: str | None = None
    options: list[str] = []
    width: Literal["full", "half", "half_row"] | None = None
    config: dict[str, Any] = {}

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="after")
    def _validate(self) -> "GuestFormField":
        if not self.key:
            raise ValueError("guest form field key cannot be empty")
        if self.type not in GUEST_FORM_FIELD_TYPES:
            allowed = ", ".join(sorted(GUEST_FORM_FIELD_TYPES))
            raise ValueError(
                f"guest form field type {self.type!r} is not allowed; use one of: {allowed}"
            )
        if not self.label:
            raise ValueError(f"guest form field {self.key!r} needs a label")
        if self.type in _CHOICE_TYPES and not self.options:
            raise ValueError(f"guest form field {self.key!r} needs options")
        return self


class GuestFormSection(BaseModel):
    """A block of questions with a heading."""

    title: str | None = None
    description: str | None = None
    fields: list[GuestFormField] = []

    model_config = ConfigDict(str_strip_whitespace=True)

    @model_validator(mode="after")
    def _validate(self) -> "GuestFormSection":
        keys = [field.key for field in self.fields]
        if len(keys) != len(set(keys)):
            raise ValueError("guest form field keys must be unique within a section")
        if len(keys) > MAX_FIELDS_PER_SECTION:
            raise ValueError(
                f"a guest form section may hold at most {MAX_FIELDS_PER_SECTION} fields"
            )
        return self


class GuestFormGuestsSection(GuestFormSection):
    """The questions asked of each additional occupant.

    ``same_as_booker`` is the default because it is the common case and the
    one that stays right when the booker's fields change later.
    """

    mode: Literal["same_as_booker", "custom", "off"] = "same_as_booker"


class AccommodationGuestForm(BaseModel):
    """The whole form: what the booker is asked, and what each guest is asked."""

    version: int = 1
    booker: GuestFormSection = GuestFormSection()
    guests: GuestFormGuestsSection = GuestFormGuestsSection()

    model_config = ConfigDict(extra="allow")

    def guest_fields(self) -> list[GuestFormField]:
        """The fields each additional guest is asked, ``mode`` resolved."""
        if self.guests.mode == "off":
            return []
        if self.guests.mode == "same_as_booker":
            return list(self.booker.fields)
        return list(self.guests.fields)

    def asks_nothing(self) -> bool:
        return not self.booker.fields and not self.guest_fields()


class GuestFormError(Exception):
    """An answer the form does not accept.

    Carries the offending field's ``key`` so the checkout can put the message
    next to the input instead of at the bottom of the page. ``guest_index`` is
    ``None`` for the booker and the zero-based occupant otherwise.
    """

    def __init__(self, message: str, *, key: str, guest_index: int | None = None):
        super().__init__(message)
        self.message = message
        self.key = key
        self.guest_index = guest_index


def parse_form(raw: Any) -> AccommodationGuestForm | None:
    """Read a stored form, or ``None`` when there is nothing to ask.

    Never raises: this reads what is already in the database, and a form that
    became unparseable (an older shape, a hand-edited row) must not take the
    checkout down with it. Writes are validated on the way in, which is where
    a bad form should be rejected.
    """
    if not raw:
        return None
    try:
        form = AccommodationGuestForm.model_validate(raw)
    except Exception:
        return None
    return None if form.asks_nothing() else form


def resolve_form(
    step_form: Any,
    property_row: Any,
) -> AccommodationGuestForm | None:
    """The form actually asked for a booking at this property.

    ``step_form`` is the step's ``template_config.guest_form``, as stored.

    ``off`` wins over anything the step configured, and ``custom`` replaces it
    rather than adding to it: an override that silently kept inheriting half
    the questions would be impossible to reason about from the property page.
    """
    mode = getattr(property_row, "guest_form_mode", None) or "inherit"

    if mode == "off":
        return None
    if mode == "custom":
        return parse_form(getattr(property_row, "guest_form", None))
    return parse_form(step_form)


def snapshot(form: AccommodationGuestForm | None) -> dict[str, Any] | None:
    """The form as it stood when the booking was made.

    Stored on the booking so the export and the booking detail can label an
    answer with the question that was actually asked. Without it, renaming a
    field would relabel every answer ever given, including the ones already
    sent to a property owner.
    """
    return form.model_dump(mode="json") if form else None


def _is_blank(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, list | dict):
        return not value
    return False


def _check_field(
    field: GuestFormField,
    answers: dict[str, Any],
    guest_index: int | None,
) -> None:
    value = answers.get(field.key)

    def fail(message: str) -> GuestFormError:
        return GuestFormError(message, key=field.key, guest_index=guest_index)

    if _is_blank(value):
        # `boolean` is the exception that proves the rule: a required consent
        # checkbox is answered by being ticked, and False is an answer that
        # does not satisfy it.
        if field.required:
            raise fail(f"{field.label} is required")
        return

    if field.type == "boolean":
        if field.required and value is not True:
            raise fail(f"{field.label} is required")
        return

    if field.type in _CHOICE_TYPES and value not in field.options:
        raise fail(f"{field.label}: pick one of the offered options")

    if field.type == "multiselect":
        values = value if isinstance(value, list) else [value]
        if field.options and any(item not in field.options for item in values):
            raise fail(f"{field.label}: pick from the offered options")

    if field.type == "email" and not _looks_like_email(value):
        raise fail(f"{field.label} does not look like an email address")

    if field.type == "number":
        number = _as_number(value)
        if number is None:
            raise fail(f"{field.label} must be a number")
        minimum = field.config.get("min")
        maximum = field.config.get("max")
        if minimum is not None and number < float(minimum):
            raise fail(f"{field.label} must be {minimum} or more")
        if maximum is not None and number > float(maximum):
            raise fail(f"{field.label} must be {maximum} or less")


def _looks_like_email(value: Any) -> bool:
    text = str(value).strip()
    if " " in text or text.count("@") != 1:
        return False
    local, _, domain = text.partition("@")
    return bool(local) and "." in domain and not domain.startswith(".")


def _as_number(value: Any) -> float | None:
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def validate_answers(
    form: AccommodationGuestForm | None,
    booker_answers: dict[str, Any] | None,
    guests: list[dict[str, Any]] | None,
) -> None:
    """Raise :class:`GuestFormError` on the first answer the form refuses.

    The booker is checked before the guests, and each guest in order, so the
    message always points at the first input the buyer would reach going down
    the page. Answers for fields the form does not define are ignored rather
    than rejected: a form that lost a question should not make an in-flight
    cart unpayable.
    """
    if form is None:
        return

    for field in form.booker.fields:
        _check_field(field, booker_answers or {}, None)

    guest_fields = form.guest_fields()
    if not guest_fields:
        return

    for index, guest in enumerate(guests or []):
        answers = guest.get("answers") if isinstance(guest, dict) else None
        for field in guest_fields:
            _check_field(field, answers or {}, index)


def normalise_guests(raw: Any) -> list[dict[str, Any]]:
    """Guests as they are stored: ``{"name": ..., "answers": {...}}``.

    Accepts the shape carts and clients used before this existed, where a
    guest was a bare name, so a cart saved yesterday still purchases today.
    Entries with neither a name nor an answer are dropped: they are the empty
    slots the checkout renders for a party that has not been filled in.
    """
    out: list[dict[str, Any]] = []
    for entry in raw or []:
        if isinstance(entry, str):
            name, answers = entry.strip(), {}
        elif isinstance(entry, dict):
            name = str(entry.get("name") or "").strip()
            raw_answers = entry.get("answers")
            answers = raw_answers if isinstance(raw_answers, dict) else {}
        else:
            continue
        if not name and not answers:
            continue
        out.append({"name": name, "answers": answers})
    return out
