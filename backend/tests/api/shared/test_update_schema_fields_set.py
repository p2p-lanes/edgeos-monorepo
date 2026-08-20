"""Every ``*Update`` schema must keep ``model_fields_set`` honest.

``BaseCRUD.update`` dumps a PATCH payload with ``exclude_unset=True``, and
several routers branch on ``"field" in model_fields_set`` to tell "the caller
sent null" from "the caller said nothing". Both read the same source of truth,
and a ``@model_validator(mode="after")`` that does ``self.field = ...``
silently corrupts it: assigning to the attribute marks the field as provided
even when the payload never mentioned it, so the next PATCH writes ``NULL``
over a column nobody touched.

That is not hypothetical — it shipped twice:

* ``TicketingStepUpdate`` rewrote ``template_config`` unconditionally, so
  reordering steps (``PATCH {"order": 2}``), renaming one inline, or toggling
  one on and off wiped the step's whole template configuration.
* ``TenantUpdate`` rewrote ``smtp_host`` unconditionally, so renaming an
  organization cleared its per-tenant SMTP host.

These tests sweep every ``*Update`` schema in ``app.api`` so the class of bug
cannot come back quietly in a schema nobody thought to re-check.
"""

import enum
import importlib
import inspect
import pkgutil
import sys
import types
import uuid
from datetime import date, datetime
from typing import Any, Union, get_args, get_origin

import pytest
from pydantic import BaseModel

import app.api as api_package

# ---------------------------------------------------------------------------
# Derivations that are meant to happen
# ---------------------------------------------------------------------------
# "module.Class" -> {field the caller sent: fields the validator may derive}.
# Anything outside this table is a leak: a field the caller never mentioned
# that the API will nonetheless write back to the database.
INTENTIONAL_DERIVATIONS: dict[str, dict[str, set[str]]] = {
    # checkout_mode is derived from sale_type and rejected as a direct input,
    # so a payload that sets sale_type must carry the resolved mode with it.
    "app.api.popup.schemas.PopupUpdate": {"sale_type": {"checkout_mode"}},
    # Patron products are donations: moving one into the category forces
    # discountable=false rather than leaving a contradictory row.
    "app.api.product.schemas.ProductUpdate": {"category": {"discountable"}},
}

# Schemas whose every field is a nested model we cannot synthesize a value for.
# Both hold a single field, so "send one field" is the whole payload anyway and
# there is no other field left for a validator to leak onto. Listed explicitly
# rather than skipped silently, so a schema that stops being sampleable for some
# other reason shows up as a failure instead of quietly dropping out.
NO_SAMPLEABLE_FIELDS = {
    "app.api.cart.schemas.CartUpdate",  # items: CartState
    "app.api.event.schemas.RecurrenceUpdate",  # recurrence: RecurrenceRule | None
}


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------
def _update_schemas() -> dict[str, type[BaseModel]]:
    """Every ``*Update`` Pydantic model reachable under ``app.api.*.schemas``."""
    for module in pkgutil.walk_packages(api_package.__path__, prefix="app.api."):
        if module.name.endswith(".schemas"):
            importlib.import_module(module.name)

    found: dict[str, type[BaseModel]] = {}
    for module_name, module in list(sys.modules.items()):
        if not (module_name.startswith("app.api") and module_name.endswith(".schemas")):
            continue
        for attr_name, obj in vars(module).items():
            if not (inspect.isclass(obj) and issubclass(obj, BaseModel)):
                continue
            if not attr_name.endswith("Update"):
                continue
            found[f"{obj.__module__}.{attr_name}"] = obj
    return found


UPDATE_SCHEMAS = _update_schemas()

# A guard on the guard: if discovery silently stops finding schemas, these
# tests would pass by vacuously iterating nothing.
MIN_EXPECTED_SCHEMAS = 40


# ---------------------------------------------------------------------------
# Sample values
# ---------------------------------------------------------------------------
_SAMPLES: dict[Any, Any] = {
    bool: True,
    str: "sample",
    int: 1,
    float: 1.0,
    dict: {},
    list: [],
    uuid.UUID: uuid.uuid4(),
    date: date(2026, 1, 1),
    datetime: datetime(2026, 1, 1, 12, 0, 0),
}


def _sample_for(annotation: Any) -> Any:
    """A plausible value for ``annotation``, or ``None`` if we can't build one.

    Only used to populate one field at a time; fields we cannot synthesize are
    skipped rather than guessed at, and the empty-payload test below covers
    every schema regardless.
    """
    # `X | None` is a types.UnionType, `Optional[X]` is a typing.Union — these
    # schemas use both, and matching only one silently skips every optional
    # field, which is all of them.
    if get_origin(annotation) in (Union, types.UnionType):
        for arg in get_args(annotation):
            if arg is type(None):
                continue
            sample = _sample_for(arg)
            if sample is not None:
                return sample
        return None

    origin = get_origin(annotation)
    if origin in (list, dict, set, tuple):
        return _SAMPLES.get(origin)

    if inspect.isclass(annotation) and issubclass(annotation, enum.Enum):
        members = list(annotation)
        return members[0] if members else None

    if inspect.isclass(annotation):
        for base, sample in _SAMPLES.items():
            if inspect.isclass(base) and issubclass(annotation, base):
                return sample

    return _SAMPLES.get(annotation)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
def test_discovery_finds_the_update_schemas() -> None:
    assert len(UPDATE_SCHEMAS) >= MIN_EXPECTED_SCHEMAS, (
        f"only found {len(UPDATE_SCHEMAS)} *Update schemas — discovery is broken, "
        "so the sweeps below are not actually checking anything"
    )


def test_exemption_lists_have_no_stale_entries() -> None:
    """An exemption for a schema that no longer exists hides a real gap."""
    unknown = (
        set(INTENTIONAL_DERIVATIONS) | NO_SAMPLEABLE_FIELDS
    ) - UPDATE_SCHEMAS.keys()
    assert not unknown, (
        f"exemptions name schemas that no longer exist: {sorted(unknown)}"
    )


@pytest.mark.parametrize("schema_path", sorted(UPDATE_SCHEMAS))
def test_empty_payload_marks_no_fields(schema_path: str) -> None:
    """``Schema()`` must report nothing as provided.

    An empty PATCH says "change nothing". Any field a validator writes here
    reaches the database as an explicit NULL on every single request.
    """
    schema = UPDATE_SCHEMAS[schema_path]
    try:
        instance = schema()
    except Exception:
        # Schema has required fields — it is not a partial-update payload, so
        # exclude_unset semantics do not apply to it.
        pytest.skip(f"{schema_path} cannot be built empty")

    assert instance.model_fields_set == set(), (
        f"{schema_path} marks {sorted(instance.model_fields_set)} as provided on an "
        "empty payload. A model_validator(mode='after') is assigning to those "
        "attributes; guard the assignment with `in self.model_fields_set` or they "
        "will be NULLed on every PATCH."
    )


@pytest.mark.parametrize("schema_path", sorted(UPDATE_SCHEMAS))
def test_single_field_payload_marks_only_that_field(schema_path: str) -> None:
    """Sending one field must not mark any other as provided."""
    schema = UPDATE_SCHEMAS[schema_path]
    allowed = INTENTIONAL_DERIVATIONS.get(schema_path, {})
    leaks: list[str] = []
    exercised = 0

    for field_name, field in schema.model_fields.items():
        sample = _sample_for(field.annotation)
        if sample is None:
            continue
        try:
            instance = schema(**{field_name: sample})
        except Exception:
            # The sample tripped a validator; this field is covered by the
            # empty-payload sweep either way.
            continue

        exercised += 1
        extra = (
            instance.model_fields_set - {field_name} - allowed.get(field_name, set())
        )
        if extra:
            leaks.append(f"{field_name!r} also marks {sorted(extra)}")

    # Without this the sweep passes by testing nothing whenever _sample_for
    # stops recognising the annotations these schemas actually use.
    if exercised == 0:
        assert schema_path in NO_SAMPLEABLE_FIELDS, (
            f"built no single-field payload for {schema_path} — _sample_for covers "
            "none of its annotations, so this sweep checked nothing"
        )
        pytest.skip(f"{schema_path} has no sampleable field")

    assert not leaks, (
        f"{schema_path} leaks fields into model_fields_set:\n  "
        + "\n  ".join(leaks)
        + "\nIf a derivation is deliberate, add it to INTENTIONAL_DERIVATIONS."
    )


def test_ticketing_step_reorder_does_not_carry_template_config() -> None:
    """Regression: dragging a step to reorder it wiped its template_config.

    The backoffice sends exactly ``{"order": n}`` for a drag, an inline rename,
    and the enable/disable toggle.
    """
    from app.api.ticketing_step.schemas import TicketingStepUpdate

    for payload in ({"order": 2}, {"title": "Tickets"}, {"is_enabled": False}):
        dumped = TicketingStepUpdate(**payload).model_dump(exclude_unset=True)
        assert "template_config" not in dumped, (
            f"PATCH {payload} would write template_config={dumped['template_config']!r}"
        )


def test_ticketing_step_explicit_null_still_clears_template_config() -> None:
    """Clearing the config on purpose must keep working."""
    from app.api.ticketing_step.schemas import TicketingStepUpdate

    dumped = TicketingStepUpdate(template_config=None).model_dump(exclude_unset=True)
    assert dumped == {"template_config": None}


def test_ticketing_step_still_validates_a_supplied_template_config() -> None:
    """The guard must not switch validation off for payloads that do carry it."""
    from app.api.ticketing_step.schemas import TicketingStepUpdate

    with pytest.raises(ValueError):
        TicketingStepUpdate(
            template="ticket-select",
            template_config={"sections": "not-a-list"},
        )


def test_tenant_rename_does_not_carry_smtp_host() -> None:
    """Regression: any tenant PATCH cleared the per-tenant SMTP host."""
    from app.api.tenant.schemas import TenantUpdate

    for payload in ({"name": "Acme"}, {"logo_url": "https://cdn.test/l.png"}):
        dumped = TenantUpdate(**payload).model_dump(exclude_unset=True)
        assert "smtp_host" not in dumped, (
            f"PATCH {payload} would write smtp_host={dumped['smtp_host']!r}"
        )


def test_tenant_smtp_host_is_still_trimmed_and_clearable() -> None:
    from app.api.tenant.schemas import TenantUpdate

    assert TenantUpdate(smtp_host="  mailpit  ").smtp_host == "mailpit"
    assert TenantUpdate(smtp_host=None).model_dump(exclude_unset=True) == {
        "smtp_host": None
    }
