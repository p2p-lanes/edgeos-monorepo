"""Backoffice group membership and deletion lifecycle tests."""

from __future__ import annotations

import uuid
from decimal import Decimal

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.application.models import Applications
from app.api.application.schemas import ApplicationStatus
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.group.models import GroupLeaders, GroupMembers, Groups
from app.api.human.models import Humans
from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.product.models import Products
from app.api.tenant.models import Tenants
from app.core.security import create_access_token
from tests._flow_helpers import group_flow_id


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_popup(db: Session, tenant: Tenants) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Group lifecycle {uuid.uuid4().hex[:6]}",
        slug=f"group-lifecycle-{uuid.uuid4().hex[:8]}",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


def _make_member_with_purchase(
    db: Session, tenant: Tenants, popup: Popups
) -> tuple[Groups, Humans, Applications, Payments, AttendeeProducts]:
    flow_id = group_flow_id(db, popup.id)
    human = Humans(
        tenant_id=tenant.id,
        email=f"group-lifecycle-{uuid.uuid4().hex[:8]}@test.com",
        first_name="Group",
        last_name="Member",
    )
    group = Groups(
        tenant_id=tenant.id,
        popup_id=popup.id,
        sales_flow_id=flow_id,
        name=f"Group {uuid.uuid4().hex[:6]}",
        slug=f"group-{uuid.uuid4().hex[:8]}",
    )
    db.add_all([human, group])
    db.flush()

    application = Applications(
        tenant_id=tenant.id,
        popup_id=popup.id,
        sales_flow_id=flow_id,
        human_id=human.id,
        group_id=group.id,
        status=ApplicationStatus.ACCEPTED.value,
    )
    attendee = Attendees(
        tenant_id=tenant.id,
        popup_id=popup.id,
        application_id=application.id,
        human_id=human.id,
        name="Group Member",
        email=human.email,
    )
    product = Products(
        tenant_id=tenant.id,
        popup_id=popup.id,
        name="Group pass",
        slug=f"group-pass-{uuid.uuid4().hex[:8]}",
        price=Decimal("100"),
    )
    payment = Payments(
        tenant_id=tenant.id,
        popup_id=popup.id,
        application_id=application.id,
        group_id=group.id,
        status=PaymentStatus.APPROVED.value,
        amount=Decimal("100"),
    )
    db.add_all([application, attendee, product, payment])
    db.flush()

    ticket = AttendeeProducts(
        tenant_id=tenant.id,
        attendee_id=attendee.id,
        product_id=product.id,
        payment_id=payment.id,
        check_in_code=f"group-{uuid.uuid4().hex[:12]}",
        product_category_snapshot="ticket",
        requires_check_in_snapshot=product.requires_check_in,
    )
    membership = GroupMembers(
        tenant_id=tenant.id,
        group_id=group.id,
        human_id=human.id,
    )
    db.add_all([ticket, membership])
    db.commit()
    db.refresh(ticket)
    return group, human, application, payment, ticket


class TestBackofficeGroupLifecycle:
    def test_superadmin_removes_member_without_human_token(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        superadmin_token: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        group, human, application, payment, ticket = _make_member_with_purchase(
            db, tenant_a, popup
        )
        db.add(
            GroupLeaders(
                tenant_id=tenant_a.id,
                group_id=group.id,
                human_id=human.id,
            )
        )
        db.commit()
        human_token = create_access_token(subject=human.id, token_type="human")

        response = client.delete(
            f"/api/v1/groups/{group.id}/members/{human.id}",
            headers={**_auth(superadmin_token), "X-Tenant-Id": str(tenant_a.id)},
        )

        assert response.status_code == 204, response.text
        db.expire_all()
        assert (
            db.exec(
                select(GroupMembers).where(
                    GroupMembers.group_id == group.id,
                    GroupMembers.human_id == human.id,
                )
            ).first()
            is None
        )
        assert (
            db.exec(
                select(GroupLeaders).where(
                    GroupLeaders.group_id == group.id,
                    GroupLeaders.human_id == human.id,
                )
            ).first()
            is None
        )
        portal_response = client.patch(
            f"/api/v1/groups/my/{group.id}",
            json={"description": "Unauthorized update"},
            headers=_auth(human_token),
        )
        assert portal_response.status_code == 403, portal_response.text
        assert db.get(Applications, application.id).group_id == group.id  # type: ignore[union-attr]
        assert (
            db.get(Applications, application.id).status
            == ApplicationStatus.ACCEPTED.value
        )  # type: ignore[union-attr]
        assert db.get(Payments, payment.id).status == PaymentStatus.APPROVED.value  # type: ignore[union-attr]
        assert db.get(AttendeeProducts, ticket.id) is not None
        assert db.get(Humans, human.id) is not None

    def test_superadmin_deletes_group_without_deleting_purchase_data(
        self,
        client: TestClient,
        db: Session,
        tenant_a: Tenants,
        superadmin_token: str,
    ) -> None:
        popup = _make_popup(db, tenant_a)
        group, human, application, payment, ticket = _make_member_with_purchase(
            db, tenant_a, popup
        )
        group_id = group.id

        response = client.delete(
            f"/api/v1/groups/{group_id}",
            headers={**_auth(superadmin_token), "X-Tenant-Id": str(tenant_a.id)},
        )

        assert response.status_code == 204, response.text
        db.expire_all()
        assert db.get(Groups, group_id) is None
        assert db.get(Applications, application.id).group_id is None  # type: ignore[union-attr]
        assert (
            db.get(Applications, application.id).status
            == ApplicationStatus.ACCEPTED.value
        )  # type: ignore[union-attr]
        assert db.get(Payments, payment.id).group_id is None  # type: ignore[union-attr]
        assert db.get(Payments, payment.id).status == PaymentStatus.APPROVED.value  # type: ignore[union-attr]
        assert db.get(AttendeeProducts, ticket.id) is not None
        assert db.get(Humans, human.id) is not None
