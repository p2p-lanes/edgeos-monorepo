"""Seed an isolated, synthetic Jon/Lucy-like scenario on the LOCAL dev database.

Run from the repo root after starting the local backend:
    docker compose exec -T backend python /tmp/seed_spouse_ticket_qa.py
Copy this script into that path first with docker compose cp. No external
payment providers are called and no authentication secrets are printed.
"""

import json
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal

from sqlmodel import Session, select

# Register all relationships before instantiating models.
from app import models  # noqa: F401
from app.api.application.models import Applications
from app.api.attendee.models import AttendeeProducts, Attendees
from app.api.attendee_category.models import AttendeeCategories
from app.api.human.models import Humans
from app.api.payment.models import PaymentProducts, PaymentRecipients, Payments
from app.api.popup.crud import popups_crud
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupCreate, PopupStatus
from app.api.product.models import Products
from app.api.sales_flow.crud import sales_flows_crud
from app.api.tenant.models import Tenants
from app.api.ticketing_step.constants import seed_ticketing_steps_for_popup
from app.core.config import Environment, settings
from app.core.db import engine

POPUP_SLUG = "spouse-ticket-qa"


def seed() -> dict:
    if settings.ENVIRONMENT != Environment.DEV or settings.POSTGRES_SERVER not in {
        "db",
        "localhost",
        "127.0.0.1",
    }:
        raise RuntimeError("This seed may only run against the local dev database")

    with Session(engine) as db:
        tenant = db.exec(select(Tenants).where(Tenants.slug == "demo")).one()
        popup = db.exec(
            select(Popups).where(
                Popups.tenant_id == tenant.id, Popups.slug == POPUP_SLUG
            )
        ).first()
        if popup is None:
            now = datetime.now(UTC)
            popup = popups_crud.create(
                db,
                PopupCreate(
                    tenant_id=tenant.id,
                    name="Spouse Ticket QA",
                    status=PopupStatus.active,
                    start_date=now - timedelta(days=1),
                    end_date=now + timedelta(days=21),
                    show_attendee_directory=True,
                ),
            )
            flow = sales_flows_crud.get_default_flow(db, popup.id)
            assert flow is not None
            seed_ticketing_steps_for_popup(
                db,
                popup_id=popup.id,
                tenant_id=tenant.id,
                sales_flow_id=flow.id,
                flow_type=flow.type,
            )
            main_category = db.exec(
                select(AttendeeCategories).where(
                    AttendeeCategories.sales_flow_id == flow.id,
                    AttendeeCategories.is_primary.is_(True),
                )
            ).one()
            spouse_category = AttendeeCategories(
                tenant_id=tenant.id,
                popup_id=popup.id,
                sales_flow_id=flow.id,
                key="spouse",
                is_primary=False,
                sort_order=1,
            )
            db.add(spouse_category)
            humans = {}
            for name in ("Jon", "Lucy", "Linked"):
                human = Humans(
                    tenant_id=tenant.id,
                    email=f"{name.lower()}.spouse.qa@example.com",
                    first_name=name,
                    last_name="QA",
                )
                db.add(human)
                db.flush()
                humans[name] = human
            apps = {}
            mains = {}
            for name in ("Jon", "Lucy"):
                application = Applications(
                    tenant_id=tenant.id,
                    popup_id=popup.id,
                    sales_flow_id=flow.id,
                    human_id=humans[name].id,
                    status="accepted",
                    accepted_at=now,
                )
                db.add(application)
                db.flush()
                apps[name] = application
                main = Attendees(
                    tenant_id=tenant.id,
                    popup_id=popup.id,
                    application_id=application.id,
                    human_id=humans[name].id,
                    email=humans[name].email,
                    name=f"{name} QA",
                    category_id=main_category.id,
                )
                db.add(main)
                db.flush()
                mains[name] = main
            unlinked = Attendees(
                tenant_id=tenant.id,
                popup_id=popup.id,
                application_id=None,
                human_id=None,
                managed_by_human_id=humans["Lucy"].id,
                email=humans["Jon"].email,
                name="Jon QA (unlinked spouse)",
                category_id=spouse_category.id,
            )
            linked = Attendees(
                tenant_id=tenant.id,
                popup_id=popup.id,
                application_id=apps["Lucy"].id,
                human_id=humans["Linked"].id,
                managed_by_human_id=humans["Lucy"].id,
                email=humans["Linked"].email,
                name="Linked QA (linked spouse)",
                category_id=spouse_category.id,
            )
            db.add_all([unlinked, linked])
            db.flush()
            products = {}
            for category, name, price in [
                ("ticket", "Full 3 Weeks - Spouse QA", "100"),
                ("ticket", "Full 3 Weeks - Standard QA", "200"),
                ("parking", "Parking QA", "5"),
            ]:
                product = Products(
                    tenant_id=tenant.id,
                    popup_id=popup.id,
                    name=name,
                    slug=name.lower().replace(" ", "-"),
                    category=category,
                    price=Decimal(price),
                    duration_type="full" if category == "ticket" else None,
                    requires_check_in=category == "ticket",
                )
                db.add(product)
                db.flush()
                products[name] = product
            payment = Payments(
                tenant_id=tenant.id,
                popup_id=popup.id,
                application_id=apps["Lucy"].id,
                buyer_human_id=humans["Lucy"].id,
                buyer_snapshot={"email": humans["Lucy"].email, "name": "Lucy QA"},
                sales_flow_id=flow.id,
                status="approved",
                source="manual",
                amount=Decimal("300"),
            )
            db.add(payment)
            db.flush()
            for attendee, product in [
                (unlinked, products["Full 3 Weeks - Spouse QA"]),
                (mains["Lucy"], products["Full 3 Weeks - Standard QA"]),
            ]:
                recipient = PaymentRecipients(
                    tenant_id=tenant.id,
                    payment_id=payment.id,
                    recipient_key=f"qa:{attendee.id}",
                    human_id=attendee.human_id,
                    attendee_id=attendee.id,
                    name=attendee.name,
                    email=attendee.email,
                    category_id=attendee.category_id,
                )
                db.add(recipient)
                db.flush()
                line = PaymentProducts(
                    tenant_id=tenant.id,
                    payment_id=payment.id,
                    product_id=product.id,
                    attendee_id=attendee.id,
                    payment_recipient_id=recipient.id,
                    quantity=1,
                    product_name=product.name,
                    product_price=product.price,
                    product_category="ticket",
                    requires_check_in_snapshot=True,
                )
                db.add(line)
                db.flush()
                db.add(
                    AttendeeProducts(
                        tenant_id=tenant.id,
                        attendee_id=attendee.id,
                        product_id=product.id,
                        payment_id=payment.id,
                        payment_product_id=line.id,
                        unit_index=0,
                        product_category_snapshot="ticket",
                        requires_check_in_snapshot=True,
                        check_in_code=f"QA{uuid.uuid4().hex[:8]}",
                    )
                )
            # Negative controls: revoked ticket and non-ticket must not leak.
            # A linked spouse also retains the existing behavior.
            for attendee, product, revoked in [
                (unlinked, products["Full 3 Weeks - Spouse QA"], True),
                (unlinked, products["Parking QA"], False),
                (linked, products["Full 3 Weeks - Spouse QA"], False),
            ]:
                db.add(
                    AttendeeProducts(
                        tenant_id=tenant.id,
                        attendee_id=attendee.id,
                        product_id=product.id,
                        product_category_snapshot=product.category,
                        requires_check_in_snapshot=product.requires_check_in,
                        revoked_at=now if revoked else None,
                        check_in_code=f"QA{uuid.uuid4().hex[:8]}",
                    )
                )
            db.commit()
        return {
            "tenant_id": str(tenant.id),
            "popup_id": str(popup.id),
            "popup_slug": popup.slug,
            "portal_url": f"http://demo.localhost:3000/portal/{popup.slug}/passes",
            "emails": [
                f"{name}.spouse.qa@example.com" for name in ("jon", "lucy", "linked")
            ],
            "created_or_existing": True,
        }


if __name__ == "__main__":
    print(json.dumps(seed(), indent=2))  # noqa: T201
