"""Repair only companion identities supported by consistent purchase evidence."""

import uuid
from datetime import UTC, datetime

from alembic import command
from alembic.config import Config
from sqlalchemy import text
from sqlmodel import Session

from app.alembic.versions import d6f2b8a94c31_restore_companion_categories as migration
from app.api.application.models import Applications
from app.api.attendee.models import Attendees
from app.api.attendee_category.models import AttendeeCategories
from app.api.human.models import Humans
from app.api.payment.models import PaymentRecipients, Payments
from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants


def test_backfill_preserves_buyers_existing_categories_and_ambiguous_history(
    migration_test_engine,
):
    with (
        migration_test_engine.connect() as connection,
        connection.begin() as transaction,
    ):
        config = Config("alembic.ini")
        config.attributes["connection"] = connection
        command.upgrade(config, migration.revision)
        command.downgrade(config, migration.down_revision)
        # This test intentionally runs at the migration's parent revision,
        # while the ORM model reflects the later SimpleFi-key and badges
        # (public profile link, popup flag) migrations.
        connection.execute(
            text("ALTER TABLE sales_flows ADD COLUMN simplefi_api_key VARCHAR")
        )
        connection.execute(
            text(
                "ALTER TABLE humans ADD COLUMN public_profile_token VARCHAR(64), "
                "ADD COLUMN public_profile_enabled BOOLEAN NOT NULL DEFAULT true"
            )
        )
        connection.execute(
            text(
                "ALTER TABLE popups ADD COLUMN badges_enabled BOOLEAN NOT NULL DEFAULT false"
            )
        )
        with Session(bind=connection, join_transaction_mode="create_savepoint") as db:
            tenant = Tenants(name="Repair test", slug=f"repair-{uuid.uuid4()}")
            db.add(tenant)
            db.flush()
            popup = Popups(
                tenant_id=tenant.id, name="Repair test", slug=f"repair-{uuid.uuid4()}"
            )
            db.add(popup)
            db.flush()
            flow = SalesFlows(
                tenant_id=tenant.id,
                popup_id=popup.id,
                name="Checkout",
                slug="checkout",
                type="direct",
            )
            other_flow = SalesFlows(
                tenant_id=tenant.id,
                popup_id=popup.id,
                name="Other",
                slug="other",
                type="direct",
            )
            buyer = Humans(
                tenant_id=tenant.id, email=f"buyer-{uuid.uuid4()}@example.com"
            )
            other_buyer = Humans(
                tenant_id=tenant.id, email=f"other-{uuid.uuid4()}@example.com"
            )
            db.add_all([flow, other_flow, buyer, other_buyer])
            db.flush()
            legacy_application = Applications(
                tenant_id=tenant.id,
                popup_id=popup.id,
                sales_flow_id=flow.id,
                human_id=buyer.id,
            )
            db.add(legacy_application)
            db.flush()
            roles = {}
            for key in ("main", "spouse", "kid", "retired", "other_flow"):
                role = AttendeeCategories(
                    tenant_id=tenant.id,
                    popup_id=popup.id,
                    sales_flow_id=other_flow.id if key == "other_flow" else flow.id,
                    key=key,
                    is_primary=key == "main",
                    deleted_at=datetime.now(UTC) if key == "retired" else None,
                )
                db.add(role)
                roles[key] = role
            db.flush()

            other_tenant = Tenants(name="Other tenant", slug=f"other-{uuid.uuid4()}")
            db.add(other_tenant)
            db.flush()
            other_popup = Popups(
                tenant_id=other_tenant.id,
                name="Other popup",
                slug=f"other-{uuid.uuid4()}",
            )
            db.add(other_popup)
            db.flush()
            foreign_flow = SalesFlows(
                tenant_id=other_tenant.id,
                popup_id=other_popup.id,
                name="Foreign",
                slug="foreign",
                type="direct",
            )
            db.add(foreign_flow)
            db.flush()
            roles["foreign_category"] = AttendeeCategories(
                tenant_id=other_tenant.id,
                popup_id=other_popup.id,
                sales_flow_id=foreign_flow.id,
                key="spouse",
            )
            db.add(roles["foreign_category"])
            db.flush()

            expected = {}

            def snapshot(attendee, role, *, status="approved", recipient_human_id=None):
                payment = Payments(
                    tenant_id=tenant.id,
                    popup_id=popup.id,
                    sales_flow_id=flow.id,
                    application_id=attendee.application_id,
                    buyer_human_id=buyer.id,
                    status=status,
                )
                db.add(payment)
                db.flush()
                db.add(
                    PaymentRecipients(
                        tenant_id=tenant.id,
                        payment_id=payment.id,
                        recipient_key=str(uuid.uuid4()),
                        attendee_id=attendee.id,
                        category_id=roles[role].id if role else None,
                        human_id=recipient_human_id,
                        name=attendee.name,
                    )
                )

            for case in (
                "companion",
                "buyer",
                "legacy_buyer",
                "main",
                "assigned",
                "pending",
                "ambiguous",
                "retired",
                "other_flow",
                "other_manager",
                "unknown",
                "foreign_category",
            ):
                attendee = Attendees(
                    tenant_id=tenant.id,
                    popup_id=popup.id,
                    name=case,
                    application_id=legacy_application.id
                    if case == "legacy_buyer"
                    else None,
                    human_id=buyer.id if case == "buyer" else None,
                    managed_by_human_id=other_buyer.id
                    if case == "other_manager"
                    else buyer.id,
                    category_id=roles["kid"].id if case == "assigned" else None,
                )
                db.add(attendee)
                db.flush()
                role = (
                    case
                    if case in ("main", "retired", "other_flow", "foreign_category")
                    else "spouse"
                )
                snapshot(
                    attendee,
                    None if case == "unknown" else role,
                    status="pending" if case == "pending" else "approved",
                    recipient_human_id=buyer.id if case == "buyer" else None,
                )
                if case == "ambiguous":
                    snapshot(attendee, "kid")
                if case == "companion":
                    snapshot(attendee, "spouse")
                expected[attendee.id] = (
                    roles["spouse"].id
                    if case == "companion"
                    else roles["kid"].id
                    if case == "assigned"
                    else None
                )
            db.commit()

            command.upgrade(config, migration.revision)
            db.expire_all()
            assert {
                attendee_id: db.get(Attendees, attendee_id).category_id
                for attendee_id in expected
            } == expected

            # Data-only downgrade preserves repaired values; upgrading again
            # is idempotent and never overwrites a category already assigned.
            command.downgrade(config, migration.down_revision)
            command.upgrade(config, migration.revision)
            db.expire_all()
            assert {
                attendee_id: db.get(Attendees, attendee_id).category_id
                for attendee_id in expected
            } == expected

        # Other migration tests share this database and exercise older schemas.
        # Leave neither these fixture rows nor a changed schema revision behind.
        transaction.rollback()
