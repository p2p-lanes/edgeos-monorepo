"""A popup's first flow is named for what it does.

It used to be called "Default", and that name reaches buyers: the portal
prints it on the door card, beside names an organiser chose like Volunteers or
Scholarship. "Default" describes where the row sits in the schema. Asked to
pick between "Default" and "Volunteers", a buyer is being handed our
vocabulary and left to guess.

The name comes from the flow's own `type`, not the popup's `sale_type`. That
popup-level split only exists because flows did not used to carry the
distinction, and it is on its way out.
"""

import uuid

from sqlmodel import Session

from app.api.popup.models import Popups
from app.api.sales_flow.crud import default_flow_name, sales_flows_crud
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants


def _popup(db: Session, tenant: Tenants, sale_type: str) -> Popups:
    popup = Popups(
        name=f"Naming {uuid.uuid4().hex[:6]}",
        slug=f"naming-{uuid.uuid4().hex[:8]}",
        tenant_id=tenant.id,
        sale_type=sale_type,
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    return popup


class TestDefaultFlowName:
    def test_a_gathering_that_takes_applications_calls_it_attendee(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, SaleType.application.value)

        flow = sales_flows_crud.provision_default_flow(
            db,
            popup_id=popup.id,
            tenant_id=tenant_a.id,
            sale_type=SaleType.application.value,
        )
        db.commit()

        assert flow.name == "Attendee"

    def test_a_gathering_that_sells_directly_calls_it_checkout(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _popup(db, tenant_a, SaleType.direct.value)

        flow = sales_flows_crud.provision_default_flow(
            db,
            popup_id=popup.id,
            tenant_id=tenant_a.id,
            sale_type=SaleType.direct.value,
        )
        db.commit()

        assert flow.name == "Checkout"

    def test_the_slug_does_not_move_with_the_name(
        self, db: Session, tenant_a: Tenants
    ) -> None:
        """The slug is a URL an operator may already have shared, and the
        resolver falls back to it. Only the label a buyer reads changed."""
        popup = _popup(db, tenant_a, SaleType.application.value)

        flow = sales_flows_crud.provision_default_flow(
            db,
            popup_id=popup.id,
            tenant_id=tenant_a.id,
            sale_type=SaleType.application.value,
        )
        db.commit()

        assert flow.slug == "default"

    def test_an_unknown_type_still_gets_a_name_a_buyer_can_read(self) -> None:
        """A default flow is never an upsale today. If one ever is, it should
        not go back to naming the schema."""
        assert default_flow_name("upsale") == "Checkout"
        assert default_flow_name("something-new") == "Checkout"
