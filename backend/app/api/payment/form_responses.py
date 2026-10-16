"""Buyer-only answer editing. Never accepts a payment or snapshot update payload."""

import math
import uuid
from copy import deepcopy
from datetime import UTC, date, datetime
from typing import Any

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlmodel import Session, select

from app.api.event_settings.crud import event_settings_crud
from app.api.form_field.crud import form_fields_crud
from app.api.form_field.models import FormFields
from app.api.form_section.models import FormSections
from app.api.payment.models import PaymentFormResponseChanges, Payments
from app.api.ticketing_step.models import TicketingSteps


class FormResponseEdit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    version: int = Field(ge=0)
    answers: dict[uuid.UUID, Any] = Field(min_length=1, max_length=100)


class FormResponseChangePublic(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    field_id: uuid.UUID
    field_label: str
    old_value: Any
    new_value: Any
    changed_by_human_id: uuid.UUID
    changed_at: datetime
    version: int


class FormResponseFieldPublic(BaseModel):
    id: uuid.UUID
    value: Any
    editable: bool
    definition: dict[str, Any]


class PaymentFormResponsesPublic(BaseModel):
    version: int
    title: str
    can_edit: bool
    editing_enabled: bool
    deadline: datetime | None
    timezone: str
    fields: list[FormResponseFieldPublic]
    history: list[FormResponseChangePublic]


def owned_payment(
    db: Session,
    payment_id: uuid.UUID,
    tenant_id: uuid.UUID,
    human_id: uuid.UUID,
    *,
    lock: bool = False,
) -> Payments:
    # Recipients may view tickets but cannot change the buyer's answers.
    query = select(Payments).where(
        Payments.id == payment_id,
        Payments.tenant_id == tenant_id,
        Payments.buyer_human_id == human_id,
    )
    if lock:
        query = query.with_for_update()
    payment = db.exec(query).first()
    if payment is None:
        raise HTTPException(404, "Payment not found")
    return payment


def buyer_step(
    db: Session, payment: Payments, *, lock: bool = False
) -> TicketingSteps | None:
    if payment.sales_flow_id is None:
        return None
    query = (
        select(TicketingSteps)
        .where(
            TicketingSteps.sales_flow_id == payment.sales_flow_id,
            TicketingSteps.popup_id == payment.popup_id,
            TicketingSteps.tenant_id == payment.tenant_id,
            TicketingSteps.step_type == "buyer",
        )
        .order_by(TicketingSteps.order)
    )
    if lock:
        query = query.with_for_update(read=True)
    return db.exec(query).first()


def snapshot_fields(payment: Payments) -> list[dict[str, Any]]:
    return [
        f
        for s in (payment.buyer_snapshot or {}).get("sections", [])
        if isinstance(s, dict)
        for f in s.get("fields", [])
        if isinstance(f, dict) and f.get("field_id")
    ]


def current_fields(
    db: Session, payment: Payments, *, lock: bool = False
) -> dict[str, FormFields]:
    if payment.sales_flow_id is None:
        return {}
    query = select(FormFields).where(
        FormFields.sales_flow_id == payment.sales_flow_id,
        FormFields.popup_id == payment.popup_id,
        FormFields.tenant_id == payment.tenant_id,
    )
    sections = select(FormSections).where(
        FormSections.sales_flow_id == payment.sales_flow_id,
        FormSections.popup_id == payment.popup_id,
        FormSections.tenant_id == payment.tenant_id,
    )
    if lock:
        query = query.with_for_update(read=True)
        sections = sections.with_for_update(read=True)
    available_sections = {
        s.id for s in db.exec(sections).all() if not s.hidden and s.kind == "standard"
    }
    return {
        str(f.id): f
        for f in db.exec(query.order_by(FormFields.position, FormFields.id)).all()
        if f.section_id is None or f.section_id in available_sections
    }


def field_snapshot(field: FormFields) -> dict[str, Any]:
    """Metadata for a question first answered after purchase."""
    return {
        "field_id": str(field.id),
        "field_name": field.name,
        "field_label": field.label,
        "field_type": field.field_type,
        "value": None,
    }


def accepts_answer(field: FormFields) -> bool:
    return field.field_type != "rich_text" or bool(
        (field.config or {}).get("is_checkbox")
    )


def append_snapshot_field(
    db: Session, snapshot: dict[str, Any], definition: FormFields
) -> dict[str, Any]:
    section_id = str(definition.section_id) if definition.section_id else None
    sections = snapshot.setdefault("sections", [])
    section = next((s for s in sections if s.get("section_id") == section_id), None)
    if section is None:
        current = (
            db.get(FormSections, definition.section_id)
            if definition.section_id
            else None
        )
        section = {
            "section_id": section_id,
            "section_label": current.label if current else "Form details",
            "section_order": current.order if current else len(sections),
            "fields": [],
        }
        sections.append(section)
    saved = field_snapshot(definition)
    section.setdefault("fields", []).append(saved)
    return saved


def can_edit(payment: Payments, step: TicketingSteps | None) -> bool:
    return bool(
        payment.status == "approved"
        and step
        and step.allow_response_editing
        and step.response_edit_deadline
        and datetime.now(UTC) < step.response_edit_deadline
    )


def read_responses(db: Session, payment: Payments) -> PaymentFormResponsesPublic:
    step = buyer_step(db, payment)
    definitions = current_fields(db, payment)
    fields = []
    saved_fields = snapshot_fields(payment)
    existing_ids = {f["field_id"] for f in saved_fields}
    # Opt-in also covers questions introduced after this payment. Reads never
    # backfill stored snapshots; an unanswered question is represented as null.
    if step and step.allow_response_editing:
        saved_fields = saved_fields + [
            field_snapshot(f)
            for key, f in definitions.items()
            if key not in existing_ids and accepts_answer(f)
        ]
    for saved in saved_fields:
        definition = definitions.get(saved["field_id"])
        editable = (
            definition is not None
            and definition.field_type == saved.get("field_type")
            and accepts_answer(definition)
        )
        schema = {
            "type": saved.get("field_type", "text"),
            "label": saved.get("field_label") or saved.get("field_name"),
            "required": definition.required if definition else False,
        }
        if definition:
            schema.update(
                {
                    "options": definition.options,
                    "config": definition.config,
                    "min_date": definition.min_date,
                    "max_date": definition.max_date,
                }
            )
        fields.append(
            {
                "id": saved["field_id"],
                "value": saved.get("value"),
                "editable": editable,
                "definition": schema,
            }
        )
    history = db.exec(
        select(PaymentFormResponseChanges)
        .where(
            PaymentFormResponseChanges.payment_id == payment.id,
            PaymentFormResponseChanges.tenant_id == payment.tenant_id,
        )
        .order_by(
            PaymentFormResponseChanges.version.desc(),
            PaymentFormResponseChanges.field_id,
        )
    ).all()
    return PaymentFormResponsesPublic(
        version=payment.form_response_version,
        title=step.title if step else "Form responses",
        can_edit=can_edit(payment, step) and any(f["editable"] for f in fields),
        editing_enabled=bool(step and step.allow_response_editing),
        deadline=step.response_edit_deadline if step else None,
        timezone=event_settings_crud.get_popup_timezone(db, payment.popup_id),
        fields=fields,
        history=[FormResponseChangePublic.model_validate(h) for h in history],
    )


def validate_answer(field: FormFields, value: Any) -> None:
    empty = (
        value is None
        or value == ""
        or value == []
        or isinstance(value, str)
        and not value.strip()
    )
    if empty:
        if field.required:
            raise HTTPException(422, f"{field.label} is required")
        return
    kind = field.field_type
    valid = False
    if kind in {
        "text",
        "textarea",
        "email",
        "url",
        "phone",
        "country_select",
        "date",
        "select",
        "select_cards",
        "radio",
        "image_upload",
    }:
        valid = isinstance(value, str)
    elif kind == "number":
        try:
            valid = (
                not isinstance(value, bool)
                and isinstance(value, (str, int, float))
                and math.isfinite(float(value))
            )
        except (ValueError, TypeError):
            valid = False
    elif (
        kind == "boolean"
        or kind == "rich_text"
        and (field.config or {}).get("is_checkbox")
    ):
        valid = isinstance(value, bool) and (
            kind == "boolean" or not field.required or value
        )
    elif kind in {"multiselect", "multiselect_detailed"}:
        valid = (
            isinstance(value, list)
            and all(isinstance(v, str) for v in value)
            and len(value) == len(set(value))
        )
    elif kind == "signature":
        valid = (
            isinstance(value, dict)
            and not (set(value) - {"signature", "signed_at"})
            and isinstance(value.get("signature"), str)
            and bool(value["signature"])
        )
        if valid and (field.config or {}).get("require_date"):
            try:
                date.fromisoformat(value.get("signed_at", ""))
            except (ValueError, TypeError):
                valid = False
    if not valid:
        raise HTTPException(422, f"Invalid value for {field.label}")
    if kind == "date":
        try:
            date.fromisoformat(value)
        except ValueError:
            raise HTTPException(422, f"Invalid date for {field.label}")
    if kind in {"url", "image_upload"} and not value.startswith(
        ("https://", "http://")
    ):
        raise HTTPException(422, f"Invalid URL for {field.label}")
    if kind == "email":
        from pydantic import EmailStr, TypeAdapter, ValidationError

        try:
            TypeAdapter(EmailStr).validate_python(value)
        except ValidationError:
            raise HTTPException(422, f"Invalid email for {field.label}")


def edit_responses(
    db: Session, payment: Payments, human_id: uuid.UUID, changes: FormResponseEdit
) -> PaymentFormResponsesPublic:
    step = buyer_step(db, payment, lock=True)
    if not can_edit(payment, step):
        raise HTTPException(
            403,
            "Response editing is disabled, the deadline has passed, or the payment is not approved",
        )
    if changes.version != payment.form_response_version:
        raise HTTPException(409, "Responses have changed. Reload before saving again")
    definitions = current_fields(db, payment, lock=True)
    snapshot = deepcopy(payment.buyer_snapshot or {})
    saved = {
        f["field_id"]: f
        for s in snapshot.get("sections", [])
        for f in s.get("fields", [])
        if f.get("field_id")
    }
    validated: dict[str, Any] = {}
    for field_id, value in changes.answers.items():
        key = str(field_id)
        field = definitions.get(key)
        if (
            field is None
            or not accepts_answer(field)
            or key in saved
            and field.field_type != saved[key].get("field_type")
        ):
            raise HTTPException(422, "Unknown or unavailable form field")
        validate_answer(field, value)
        validated[field.name] = value
    # A partial PATCH cannot omit a newly introduced required question.
    for key, field in definitions.items():
        if key not in saved and field.required and accepts_answer(field):
            validate_answer(field, changes.answers.get(field.id))
    valid, errors = form_fields_crud.validate_custom_fields(
        db,
        payment.popup_id,
        validated,
        skip_required=True,
        sales_flow_id=payment.sales_flow_id,
    )
    if not valid:
        raise HTTPException(422, errors)
    if not can_edit(payment, step):
        raise HTTPException(403, "The editing deadline has passed")
    version = payment.form_response_version + 1
    changed_at = datetime.now(UTC)
    # All validation precedes writes, so a rejected batch changes nothing.
    changed = False
    for field_id, value in changes.answers.items():
        key = str(field_id)
        field = saved.get(key)
        if field is None:
            # Optional unanswered questions remain absent; persist only answers.
            if (
                value is None
                or value == ""
                or value == []
                or isinstance(value, str)
                and not value.strip()
            ):
                continue
            field = append_snapshot_field(db, snapshot, definitions[key])
            saved[key] = field
        if field.get("value") == value:
            continue
        db.add(
            PaymentFormResponseChanges(
                tenant_id=payment.tenant_id,
                payment_id=payment.id,
                field_id=field_id,
                field_label=field.get("field_label")
                or field.get("field_name")
                or "Form response",
                old_value=field.get("value"),
                new_value=value,
                changed_by_human_id=human_id,
                changed_at=changed_at,
                version=version,
            )
        )
        field["value"] = value
        changed = True
    if changed:
        payment.buyer_snapshot = snapshot
        payment.form_response_version = version
        db.add(payment)
    db.commit()
    db.refresh(payment)
    return read_responses(db, payment)
