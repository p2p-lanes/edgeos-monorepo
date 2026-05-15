"""Tests for Express Checkout (group flow) required-field validation scope.

The portal /groups Express Checkout renders only the personal-information
subset of the application form (mirrors getCheckoutMiniFormSchema in
portal/src/app/checkout/types.ts). The backend must mirror that scope when
validating required fields so users aren't blocked on fields the form never
showed.
"""

import uuid

from sqlmodel import Session

from app.api.base_field_config.models import BaseFieldConfigs
from app.api.form_field.crud import form_fields_crud
from app.api.form_field.models import FormFields
from app.api.form_section.models import FormSections
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        name=f"Popup {uuid.uuid4().hex[:8]}",
        slug=f"popup-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
    )
    db.add(popup)
    db.flush()
    return popup


def _make_section(
    db: Session, tenant: Tenants, popup: Popups, *, label: str, order: int
) -> FormSections:
    section = FormSections(
        tenant_id=tenant.id,
        popup_id=popup.id,
        label=label,
        order=order,
    )
    db.add(section)
    db.flush()
    return section


def _make_field(
    db: Session,
    tenant: Tenants,
    popup: Popups,
    section: FormSections,
    *,
    name: str,
    label: str,
    required: bool,
) -> FormFields:
    field = FormFields(
        tenant_id=tenant.id,
        popup_id=popup.id,
        section_id=section.id,
        name=name,
        label=label,
        field_type="text",
        required=required,
    )
    db.add(field)
    db.flush()
    return field


class TestExpressCheckoutCustomFields:
    def test_required_custom_field_outside_personal_section_is_skipped(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """A required custom field in a non-personal section is enforced for
        regular applications but skipped for Express Checkout (group flow)."""
        popup = _make_popup(db, tenant_a)
        personal_section = _make_section(
            db, tenant_a, popup, label="Personal Information", order=0
        )
        extra_section = _make_section(
            db, tenant_a, popup, label="Organization", order=1
        )

        # Anchor the personal section with a target=human base field so the
        # express-checkout scope includes it.
        db.add(
            BaseFieldConfigs(
                tenant_id=tenant_a.id,
                popup_id=popup.id,
                field_name="telegram",
                section_id=personal_section.id,
                required=False,
                position=0,
            )
        )
        _make_field(
            db,
            tenant_a,
            popup,
            extra_section,
            name="organization",
            label="Organization you represent",
            required=True,
        )
        db.commit()

        is_valid_regular, errors_regular = form_fields_crud.validate_custom_fields(
            db, popup.id, {}, is_express_checkout=False
        )
        assert not is_valid_regular
        assert any("Organization you represent" in e for e in errors_regular)

        is_valid_express, errors_express = form_fields_crud.validate_custom_fields(
            db, popup.id, {}, is_express_checkout=True
        )
        assert is_valid_express, errors_express

    def test_required_custom_field_inside_personal_section_is_enforced(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Required custom fields in the personal section are still enforced
        under Express Checkout — only fields outside it are scoped out."""
        popup = _make_popup(db, tenant_a)
        personal_section = _make_section(
            db, tenant_a, popup, label="Personal Information", order=0
        )

        db.add(
            BaseFieldConfigs(
                tenant_id=tenant_a.id,
                popup_id=popup.id,
                field_name="telegram",
                section_id=personal_section.id,
                required=False,
                position=0,
            )
        )
        _make_field(
            db,
            tenant_a,
            popup,
            personal_section,
            name="eth_address",
            label="ETH address",
            required=True,
        )
        db.commit()

        is_valid, errors = form_fields_crud.validate_custom_fields(
            db, popup.id, {}, is_express_checkout=True
        )
        assert not is_valid
        assert any("ETH address" in e for e in errors)


class TestExpressCheckoutBaseFields:
    def test_required_application_targeted_base_field_is_skipped(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """Base fields whose target is `application` (e.g. referral) aren't
        rendered by Express Checkout, so a required configuration must not
        block a group-flow submission."""
        popup = _make_popup(db, tenant_a)
        section = _make_section(
            db, tenant_a, popup, label="Personal Information", order=0
        )
        db.add(
            BaseFieldConfigs(
                tenant_id=tenant_a.id,
                popup_id=popup.id,
                field_name="referral",
                section_id=section.id,
                required=True,
                position=0,
            )
        )
        db.commit()

        is_valid_regular, errors_regular = form_fields_crud.validate_base_fields(
            db, popup.id, {}, human=None, is_express_checkout=False
        )
        assert not is_valid_regular
        assert any("refer" in e.lower() for e in errors_regular)

        is_valid_express, errors_express = form_fields_crud.validate_base_fields(
            db, popup.id, {}, human=None, is_express_checkout=True
        )
        assert is_valid_express, errors_express
