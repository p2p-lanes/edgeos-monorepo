"""Tests for RADIO and MULTISELECT_DETAILED form field validation."""

import uuid

from sqlmodel import Session

from app.api.form_field.crud import form_fields_crud
from app.api.form_field.models import FormFields
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def _make_popup_with_field(
    db: Session,
    tenant: Tenants,
    *,
    field_type: str,
    options: list[str],
    config: dict | None = None,
) -> tuple[Popups, str]:
    popup = Popups(
        name=f"Popup {uuid.uuid4().hex[:8]}",
        slug=f"popup-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.flush()

    field = FormFields(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name=f"f_{uuid.uuid4().hex[:6]}",
        label="My Field",
        field_type=field_type,
        options=options,
        config=config,
    )
    db.add(field)
    db.commit()
    db.refresh(field)
    return popup, field.name


class TestRadioValidation:
    def test_radio_value_in_options_passes(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup, field_name = _make_popup_with_field(
            db, tenant_a, field_type="radio", options=["a", "b", "c"]
        )
        is_valid, errors = form_fields_crud.validate_custom_fields(
            db, popup.id, {field_name: "b"}
        )
        assert is_valid, errors

    def test_radio_value_outside_options_fails(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup, field_name = _make_popup_with_field(
            db, tenant_a, field_type="radio", options=["a", "b", "c"]
        )
        is_valid, errors = form_fields_crud.validate_custom_fields(
            db, popup.id, {field_name: "z"}
        )
        assert not is_valid
        assert any("My Field" in e for e in errors), errors


class TestMultiselectDetailedValidation:
    def test_valid_selection_passes(self, db: Session, tenant_a: Tenants) -> None:
        popup, field_name = _make_popup_with_field(
            db,
            tenant_a,
            field_type="multiselect_detailed",
            options=["a", "b", "c"],
            config={"min_selections": 1, "max_selections": 2},
        )
        is_valid, errors = form_fields_crud.validate_custom_fields(
            db, popup.id, {field_name: ["a", "b"]}
        )
        assert is_valid, errors

    def test_below_min_fails(self, db: Session, tenant_a: Tenants) -> None:
        popup, field_name = _make_popup_with_field(
            db,
            tenant_a,
            field_type="multiselect_detailed",
            options=["a", "b", "c"],
            config={"min_selections": 2},
        )
        is_valid, errors = form_fields_crud.validate_custom_fields(
            db, popup.id, {field_name: ["a"]}
        )
        assert not is_valid
        assert any("at least 2" in e for e in errors), errors

    def test_above_max_fails(self, db: Session, tenant_a: Tenants) -> None:
        popup, field_name = _make_popup_with_field(
            db,
            tenant_a,
            field_type="multiselect_detailed",
            options=["a", "b", "c"],
            config={"max_selections": 1},
        )
        is_valid, errors = form_fields_crud.validate_custom_fields(
            db, popup.id, {field_name: ["a", "b"]}
        )
        assert not is_valid
        assert any("at most 1" in e for e in errors), errors

    def test_invalid_option_fails(self, db: Session, tenant_a: Tenants) -> None:
        popup, field_name = _make_popup_with_field(
            db,
            tenant_a,
            field_type="multiselect_detailed",
            options=["a", "b", "c"],
        )
        is_valid, errors = form_fields_crud.validate_custom_fields(
            db, popup.id, {field_name: ["a", "z"]}
        )
        assert not is_valid
        assert any("invalid options" in e for e in errors), errors

    def test_no_config_no_limits(self, db: Session, tenant_a: Tenants) -> None:
        popup, field_name = _make_popup_with_field(
            db,
            tenant_a,
            field_type="multiselect_detailed",
            options=["a", "b", "c"],
        )
        is_valid, errors = form_fields_crud.validate_custom_fields(
            db, popup.id, {field_name: ["a", "b", "c"]}
        )
        assert is_valid, errors
