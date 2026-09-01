"""Express Checkout scope follows the ENTRY FLOW, not a per-link flag.

The portal renders the reduced mini-form for every group / invite / referral
entry point (PersonalInfoForm -> getCheckoutMiniFormSchema in
portal/src/app/checkout/types.ts), unconditionally. The backend must validate
the same scope, otherwise it rejects required fields the applicant was never
shown.

This supersedes T-gr-016, which derived the scope from
group.express_checkout / invite.express_checkout. Those flags never reached
the portal, so the two sides could disagree — and referrals, having no flag at
all, disagreed every single time.
"""

from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from httpx import Response
from sqlmodel import Session

from app.api.base_field_config.models import BaseFieldConfigs
from app.api.form_field.models import FormFields
from app.api.form_section.models import FormSections
from app.api.group.models import Groups
from app.api.human.models import Humans
from app.api.invite.models import Invites
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.core.security import create_access_token

REQUIRED_OUTSIDE_LABEL = "T-Shirt Size"


def _human_token(human: Humans) -> str:
    return create_access_token(subject=human.id, token_type="human")


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_human(db: Session, tenant: Tenants) -> Humans:
    human = Humans(
        tenant_id=tenant.id,
        email=f"entryflow-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Entry",
        last_name="Flow",
    )
    db.add(human)
    db.commit()
    db.refresh(human)
    return human


def _make_popup_with_required_field_outside_express(
    db: Session, tenant: Tenants
) -> Popups:
    """Popup whose form has a required custom field the mini-form never shows.

    Layout mirrors the reported bug: a personal section anchored by a
    target=human base field (so it is inside the express scope) plus a second
    section holding a required custom field (so it is outside).
    """
    popup = Popups(
        name=f"EntryFlow {uuid.uuid4().hex[:6]}",
        slug=f"entryflow-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
        invites_enabled=True,
        referrals_enabled=True,
    )
    db.add(popup)
    db.flush()

    personal_section = FormSections(
        tenant_id=tenant.id,
        popup_id=popup.id,
        label="Personal Information",
        order=0,
    )
    extra_section = FormSections(
        tenant_id=tenant.id,
        popup_id=popup.id,
        label="Logistics",
        order=1,
    )
    db.add(personal_section)
    db.add(extra_section)
    db.flush()

    db.add(
        BaseFieldConfigs(
            tenant_id=tenant.id,
            popup_id=popup.id,
            field_name="telegram",
            section_id=personal_section.id,
            required=False,
            position=0,
        )
    )
    db.add(
        FormFields(
            tenant_id=tenant.id,
            popup_id=popup.id,
            section_id=extra_section.id,
            name="tshirt_size",
            label=REQUIRED_OUTSIDE_LABEL,
            field_type="text",
            required=True,
        )
    )
    db.commit()
    db.refresh(popup)
    return popup


def _make_group(db: Session, popup: Popups) -> Groups:
    group = Groups(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        name=f"Entry Group {uuid.uuid4().hex[:6]}",
        slug=f"entry-grp-{uuid.uuid4().hex[:8]}",
        auto_approve_applications=False,
        express_checkout=False,
    )
    db.add(group)
    db.commit()
    db.refresh(group)
    return group


def _make_invite(db: Session, popup: Popups, creator: Users) -> Invites:
    invite = Invites(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        token=f"tok-{uuid.uuid4().hex[:16]}",
        max_uses=None,
        auto_approve=False,
        express_checkout=False,
        discount_percentage=Decimal("0"),
        created_by=creator.id,
    )
    db.add(invite)
    db.commit()
    db.refresh(invite)
    return invite


def _make_referral(db: Session, popup: Popups, referrer: Humans) -> Invites:
    """A referral is an Invite carrying a referrer_human_id."""
    referral = Invites(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        referrer_human_id=referrer.id,
        token=f"ref-{uuid.uuid4().hex[:12]}",
        auto_approve=True,
        express_checkout=True,
        discount_percentage=Decimal("0"),
    )
    db.add(referral)
    db.commit()
    db.refresh(referral)
    return referral


def _submit(client: TestClient, popup: Popups, human: Humans, **link: str) -> Response:
    return client.post(
        "/api/v1/applications/my",
        json={
            "popup_id": str(popup.id),
            "first_name": "Entry",
            "last_name": "Flow",
            "status": "in review",
            **link,
        },
        headers=_auth(_human_token(human)),
    )


class TestExpressCheckoutEntryFlow:
    def test_direct_application_still_enforces_the_required_field(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Control: without a link the full form applies, so the field is required.

        Without this the other cases would pass even if validation were simply
        switched off.
        """
        popup = _make_popup_with_required_field_outside_express(db, tenant_a)
        human = _make_human(db, tenant_a)

        resp = _submit(client, popup, human)

        assert resp.status_code == 400, resp.json()
        assert REQUIRED_OUTSIDE_LABEL in str(resp.json()["detail"])

    def test_referral_entry_skips_fields_the_mini_form_never_rendered(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """The reported bug: referral express checkout 400'd on a hidden field."""
        popup = _make_popup_with_required_field_outside_express(db, tenant_a)
        referrer = _make_human(db, tenant_a)
        human = _make_human(db, tenant_a)
        referral = _make_referral(db, popup, referrer)

        resp = _submit(client, popup, human, referral_id=str(referral.id))

        assert resp.status_code in (200, 201), resp.json()

    def test_group_entry_skips_them_even_with_express_checkout_false(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """The flag is no longer read: entering through the link is what counts."""
        popup = _make_popup_with_required_field_outside_express(db, tenant_a)
        human = _make_human(db, tenant_a)
        group = _make_group(db, popup)

        resp = _submit(client, popup, human, group_id=str(group.id))

        assert resp.status_code in (200, 201), resp.json()

    def test_invite_entry_skips_them_even_with_express_checkout_false(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        admin_user_tenant_a: Users,
    ) -> None:
        popup = _make_popup_with_required_field_outside_express(db, tenant_a)
        human = _make_human(db, tenant_a)
        invite = _make_invite(db, popup, admin_user_tenant_a)

        resp = _submit(client, popup, human, invite_id=str(invite.id))

        assert resp.status_code in (200, 201), resp.json()

    def test_resubmitting_a_referral_application_stays_in_express_scope(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """The update path must mirror create, or the second save 400s.

        validate_portal_update derived the scope from group_id alone, so an
        application that entered through an invite or referral was validated
        against the full form the moment the applicant edited it.
        """
        popup = _make_popup_with_required_field_outside_express(db, tenant_a)
        referrer = _make_human(db, tenant_a)
        human = _make_human(db, tenant_a)
        referral = _make_referral(db, popup, referrer)

        created = _submit(client, popup, human, referral_id=str(referral.id))
        assert created.status_code in (200, 201), created.json()

        resp = client.patch(
            f"/api/v1/applications/my/{popup.id}",
            json={"first_name": "Edited", "status": "in review"},
            headers=_auth(_human_token(human)),
        )

        assert resp.status_code == 200, resp.json()
        # first_name lands on the Human record, not on ApplicationPublic.
        db.refresh(human)
        assert human.first_name == "Edited"
