import json
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

from dateutil.parser import parse as parse_datetime
from loguru import logger
from sqlmodel import Session, create_engine, select

from app.api.shared.enums import HumanRating, UserRole
from app.core.config import settings

engine = create_engine(
    str(settings.SQLALCHEMY_DATABASE_URI),
    pool_size=5,
    max_overflow=10,  # Allow burst connections beyond pool_size
    pool_pre_ping=True,  # Verify connections before use
    pool_recycle=3600,  # Recycle connections after 1 hour
    pool_timeout=30,  # Wait max 30s for a connection from pool
)

SEED_DATA_PATH = Path(__file__).parent / "seed_data.json"


def _load_seed_data() -> dict:
    """Load seed data from JSON file."""
    with open(SEED_DATA_PATH) as f:
        return json.load(f)


def _seed_superadmin(session: Session) -> None:
    from app.models import Users

    user = session.exec(select(Users).where(Users.email == settings.SUPERADMIN)).first()
    if not user:
        user = Users(
            email=settings.SUPERADMIN,
            role=UserRole.SUPERADMIN,
        )
        session.add(user)
        session.commit()
        logger.info(f"Superadmin created: {settings.SUPERADMIN}")


def _seed_tenant(session: Session, seed_data: dict):
    from app.core.tenant_db import ensure_tenant_credentials
    from app.models import Tenants

    tenant_data = seed_data["tenant"]
    demo_tenant = session.exec(
        select(Tenants).where(Tenants.slug == tenant_data["slug"])
    ).first()
    if not demo_tenant:
        demo_tenant = Tenants(
            name=tenant_data["name"],
            slug=tenant_data["slug"],
        )
        session.add(demo_tenant)
        session.commit()
        session.refresh(demo_tenant)
        logger.info(f"Demo tenant created: {demo_tenant.id}")

        ensure_tenant_credentials(session, demo_tenant.id)
        logger.info("Demo tenant credentials created")

    return demo_tenant


def _seed_users(session: Session, seed_data: dict, tenant_id) -> None:
    from app.models import Users

    for user_key, user_data in seed_data["users"].items():
        existing_user = session.exec(
            select(Users).where(
                Users.email == user_data["email"], Users.tenant_id == tenant_id
            )
        ).first()
        if not existing_user:
            new_user = Users(
                email=user_data["email"],
                full_name=user_data.get("full_name"),
                role=UserRole(user_data["role"]),
                tenant_id=tenant_id,
            )
            session.add(new_user)
            session.commit()
            logger.info(f"Demo {user_key} user created: {user_data['email']}")


def _seed_popups(session: Session, seed_data: dict, tenant_id) -> dict:
    from app.models import Popups

    popup_map: dict[str, Popups] = {}
    for popup_data in seed_data.get("popups", []):
        popup_key = popup_data["key"]
        existing_popup = session.exec(
            select(Popups).where(
                Popups.slug == popup_data["slug"], Popups.tenant_id == tenant_id
            )
        ).first()
        if existing_popup:
            popup_map[popup_key] = existing_popup
        else:
            popup = Popups(
                tenant_id=tenant_id,
                name=popup_data["name"],
                slug=popup_data["slug"],
                status=popup_data.get("status", "draft"),
                allows_coupons=popup_data.get("allows_coupons", False),
                start_date=(
                    parse_datetime(popup_data["start_date"])
                    if popup_data.get("start_date")
                    else None
                ),
                end_date=(
                    parse_datetime(popup_data["end_date"])
                    if popup_data.get("end_date")
                    else None
                ),
            )
            session.add(popup)
            session.commit()
            session.refresh(popup)
            popup_map[popup_key] = popup
            logger.info(f"Popup created: {popup.name} ({popup_key})")

    return popup_map


def _seed_base_field_configs(session: Session, popup_map: dict, tenant_id) -> None:
    from app.api.base_field_config.constants import DEFAULT_SECTIONS
    from app.api.base_field_config.crud import base_field_configs_crud
    from app.api.base_field_config.models import BaseFieldConfigs
    from app.models import FormSections

    for popup_key, popup in popup_map.items():
        existing_configs = session.exec(
            select(BaseFieldConfigs).where(BaseFieldConfigs.popup_id == popup.id)
        ).first()
        if existing_configs:
            continue

        default_section_map = {}
        for section_key, section_def in DEFAULT_SECTIONS.items():
            existing_section = session.exec(
                select(FormSections).where(
                    FormSections.label == section_def["label"],
                    FormSections.popup_id == popup.id,
                )
            ).first()
            if existing_section:
                default_section_map[section_key] = existing_section.id
            else:
                section = FormSections(
                    tenant_id=tenant_id,
                    popup_id=popup.id,
                    label=section_def["label"],
                    order=section_def["order"],
                    protected=True,
                    kind=section_def["kind"],
                )
                session.add(section)
                session.commit()
                session.refresh(section)
                default_section_map[section_key] = section.id
                logger.info(f"Default section created: {section.label} for {popup_key}")

        base_field_configs_crud.create_defaults_for_popup(
            session, popup.id, tenant_id, default_section_map
        )
        logger.info(f"Base field configs created for {popup_key}")


def _seed_ticketing_steps(session: Session, popup_map: dict, tenant_id) -> None:
    from app.api.ticketing_step.constants import seed_ticketing_steps_for_popup
    from app.models import TicketingSteps

    for popup_key, popup in popup_map.items():
        existing = session.exec(
            select(TicketingSteps).where(TicketingSteps.popup_id == popup.id)
        ).first()
        if existing:
            continue

        seed_ticketing_steps_for_popup(
            session,
            popup_id=popup.id,
            tenant_id=tenant_id,
            sale_type=str(popup.sale_type) if popup.sale_type else None,
        )
        logger.info(f"Ticketing steps seeded for {popup_key}")


def _seed_approval_strategies(session: Session, popup_map: dict, tenant_id) -> None:
    from app.api.approval_strategy.schemas import ApprovalStrategyType
    from app.models import ApprovalStrategies

    for popup_key, popup in popup_map.items():
        existing_strategy = session.exec(
            select(ApprovalStrategies).where(ApprovalStrategies.popup_id == popup.id)
        ).first()
        if not existing_strategy:
            strategy = ApprovalStrategies(
                tenant_id=tenant_id,
                popup_id=popup.id,
                strategy_type=ApprovalStrategyType.AUTO_ACCEPT,
            )
            session.add(strategy)
            session.commit()
            logger.info(f"Approval strategy created: auto_accept for {popup_key}")


def _seed_attendee_categories(
    session: Session, seed_data: dict, popup_map: dict, tenant_id
) -> dict[str, dict[str, uuid.UUID]]:
    """Seed per-popup attendee categories before products/attendees that reference them.

    For each popup, always creates `main` (primary) and additionally creates any
    category key referenced by the popup's products or attendees in seed_data.

    Returns {popup_key: {cat_key: category_id}}.
    """
    from app.api.attendee_category.models import AttendeeCategories

    REQUIRED_FIELDS_BY_KEY: dict[str, list[dict]] = {
        "spouse": [{"name": "email", "type": "email", "required": True}],
        "kid": [
            {
                "name": "age_group",
                "type": "select",
                "required": True,
                "options": ["baby", "kid", "teen"],
                "label": "Age group",
                "display_as_subtitle": True,
            }
        ],
    }
    SORT_ORDER_BY_KEY: dict[str, int] = {"main": 0, "spouse": 1, "kid": 2}
    MAX_PER_APPLICATION_BY_KEY: dict[str, int | None] = {"spouse": 1}

    keys_per_popup: dict[str, set[str]] = {pk: {"main"} for pk in popup_map}
    for product_data in seed_data.get("products", []):
        cat_key = product_data.get("attendee_category")
        if cat_key:
            keys_per_popup.setdefault(product_data["popup_key"], set()).add(cat_key)
    for app_data in seed_data.get("applications", []):
        popup_key = app_data.get("popup_key")
        if not popup_key:
            continue
        for attendee_data in app_data.get("attendees", []):
            cat_key = attendee_data.get("category")
            if cat_key:
                keys_per_popup.setdefault(popup_key, set()).add(cat_key)

    result: dict[str, dict[str, uuid.UUID]] = {}
    for popup_key, popup in popup_map.items():
        existing = session.exec(
            select(AttendeeCategories).where(AttendeeCategories.popup_id == popup.id)
        ).all()
        result[popup_key] = {cat.key: cat.id for cat in existing}

        for cat_key in keys_per_popup.get(popup_key, {"main"}):
            if cat_key in result[popup_key]:
                continue
            category = AttendeeCategories(
                tenant_id=tenant_id,
                popup_id=popup.id,
                key=cat_key,
                is_primary=(cat_key == "main"),
                sort_order=SORT_ORDER_BY_KEY.get(cat_key, 99),
                enabled_in_passes_flow=True,
                max_per_application=MAX_PER_APPLICATION_BY_KEY.get(cat_key),
                required_fields=REQUIRED_FIELDS_BY_KEY.get(cat_key, []),
                display_meta={},
            )
            session.add(category)
            session.commit()
            session.refresh(category)
            result[popup_key][cat_key] = category.id
            logger.info(f"Attendee category created: {cat_key} for {popup_key}")

    return result


def _seed_products(
    session: Session,
    seed_data: dict,
    popup_map: dict,
    tenant_id,
    attendee_category_map: dict[str, dict[str, uuid.UUID]],
) -> dict:
    from app.models import Products

    product_map: dict[str, Products] = {}
    for product_data in seed_data.get("products", []):
        popup_key = product_data["popup_key"]
        popup = popup_map.get(popup_key)
        if not popup:
            logger.warning(
                f"Popup {popup_key} not found for product {product_data['name']}"
            )
            continue

        product_slug = product_data["slug"]
        map_key = f"{popup_key}:{product_slug}"

        existing_product = session.exec(
            select(Products).where(
                Products.slug == product_slug,
                Products.popup_id == popup.id,
                Products.deleted_at.is_(None),  # type: ignore[attr-defined]
            )
        ).first()
        if existing_product:
            product_map[map_key] = existing_product
        else:
            cat_key = product_data.get("attendee_category")
            attendee_category_id = (
                attendee_category_map.get(popup_key, {}).get(cat_key)
                if cat_key
                else None
            )
            product = Products(
                tenant_id=tenant_id,
                popup_id=popup.id,
                name=product_data["name"],
                slug=product_slug,
                price=Decimal(product_data["price"]),
                compare_price=(
                    Decimal(product_data["compare_price"])
                    if product_data.get("compare_price")
                    else None
                ),
                description=product_data.get("description"),
                category=product_data.get("category", "ticket"),
                attendee_category_id=attendee_category_id,
                duration_type=product_data.get("duration_type"),
                requires_check_in=product_data.get("requires_check_in", False),
                start_date=(
                    parse_datetime(product_data["start_date"])
                    if product_data.get("start_date")
                    else None
                ),
                end_date=(
                    parse_datetime(product_data["end_date"])
                    if product_data.get("end_date")
                    else None
                ),
                is_active=product_data.get("is_active", True),
                exclusive=product_data.get("exclusive", False),
                total_stock_cap=product_data.get("total_stock_cap"),
                total_stock_remaining=product_data.get(
                    "total_stock_cap"
                ),  # init remaining = cap
            )
            session.add(product)
            session.commit()
            session.refresh(product)
            product_map[map_key] = product
            logger.info(f"Product created: {product.name} for {popup_key}")

    return product_map


def _seed_form_sections(
    session: Session, seed_data: dict, popup_map: dict, tenant_id
) -> dict:
    from app.models import FormSections

    section_map: dict[str, FormSections] = {}
    for section_data in seed_data.get("form_sections", []):
        section_key = section_data["key"]
        popup_key = section_data["popup_key"]
        popup = popup_map.get(popup_key)
        if not popup:
            logger.warning(
                f"Popup {popup_key} not found for form section {section_data['label']}"
            )
            continue

        existing_section = session.exec(
            select(FormSections).where(
                FormSections.label == section_data["label"],
                FormSections.popup_id == popup.id,
            )
        ).first()
        if existing_section:
            section_map[section_key] = existing_section
        else:
            section = FormSections(
                tenant_id=tenant_id,
                popup_id=popup.id,
                label=section_data["label"],
                description=section_data.get("description"),
                order=section_data.get("order", 0),
                protected=section_data.get("protected", False),
            )
            session.add(section)
            session.commit()
            session.refresh(section)
            section_map[section_key] = section
            logger.info(f"Form section created: {section.label} for {popup_key}")

    return section_map


def _seed_form_fields(
    session: Session, seed_data: dict, popup_map: dict, section_map: dict, tenant_id
) -> None:
    from app.models import FormFields

    for field_data in seed_data.get("form_fields", []):
        popup_key = field_data["popup_key"]
        popup = popup_map.get(popup_key)
        if not popup:
            logger.warning(
                f"Popup {popup_key} not found for form field {field_data['name']}"
            )
            continue

        section_id = None
        if field_data.get("section_key"):
            section = section_map.get(field_data["section_key"])
            if section:
                section_id = section.id

        existing_field = session.exec(
            select(FormFields).where(
                FormFields.name == field_data["name"], FormFields.popup_id == popup.id
            )
        ).first()
        if not existing_field:
            field = FormFields(
                tenant_id=tenant_id,
                popup_id=popup.id,
                name=field_data["name"],
                label=field_data["label"],
                field_type=field_data.get("field_type", "text"),
                section_id=section_id,
                position=field_data.get("position", 0),
                required=field_data.get("required", False),
                options=field_data.get("options"),
                placeholder=field_data.get("placeholder"),
                help_text=field_data.get("help_text"),
            )
            session.add(field)
            session.commit()
            logger.info(f"Form field created: {field.name} for {popup_key}")


def _seed_coupons(
    session: Session, seed_data: dict, popup_map: dict, tenant_id
) -> dict:
    from app.models import Coupons

    coupon_map: dict[str, Coupons] = {}
    for coupon_data in seed_data.get("coupons", []):
        popup_key = coupon_data["popup_key"]
        popup = popup_map.get(popup_key)
        if not popup:
            logger.warning(
                f"Popup {popup_key} not found for coupon {coupon_data['code']}"
            )
            continue

        code = coupon_data["code"].upper()
        map_key = f"{popup_key}:{code}"

        existing_coupon = session.exec(
            select(Coupons).where(Coupons.code == code, Coupons.popup_id == popup.id)
        ).first()
        if existing_coupon:
            coupon_map[map_key] = existing_coupon
        else:
            coupon = Coupons(
                tenant_id=tenant_id,
                popup_id=popup.id,
                code=code,
                discount_value=coupon_data["discount_value"],
                max_uses=coupon_data.get("max_uses"),
                start_date=(
                    parse_datetime(coupon_data["start_date"])
                    if coupon_data.get("start_date")
                    else None
                ),
                end_date=(
                    parse_datetime(coupon_data["end_date"])
                    if coupon_data.get("end_date")
                    else None
                ),
                is_active=coupon_data.get("is_active", True),
            )
            session.add(coupon)
            session.commit()
            session.refresh(coupon)
            coupon_map[map_key] = coupon
            logger.info(f"Coupon created: {coupon.code} for {popup_key}")

    return coupon_map


def _seed_humans(session: Session, seed_data: dict, tenant_id) -> dict:
    from app.models import Humans

    human_map: dict[str, Humans] = {}
    for human_data in seed_data.get("humans", []):
        human_key = human_data["key"]
        email = human_data["email"].lower().strip()

        existing_human = session.exec(
            select(Humans).where(Humans.email == email, Humans.tenant_id == tenant_id)
        ).first()
        if existing_human:
            human_map[human_key] = existing_human
        else:
            human = Humans(
                tenant_id=tenant_id,
                email=email,
                first_name=human_data.get("first_name"),
                last_name=human_data.get("last_name"),
                telegram=human_data.get("telegram"),
                gender=human_data.get("gender"),
                age=human_data.get("age"),
                residence=human_data.get("residence"),
                rating=(
                    HumanRating.RED_FLAG
                    if human_data.get("red_flag", False)
                    else HumanRating.UNRATED
                ),
            )
            session.add(human)
            session.commit()
            session.refresh(human)
            human_map[human_key] = human
            logger.info(f"Human created: {human.email} ({human_key})")

    return human_map


def _seed_groups(
    session: Session, seed_data: dict, popup_map: dict, human_map: dict, tenant_id
) -> dict:
    from app.models import GroupLeaders, GroupMembers, Groups

    group_map: dict[str, Groups] = {}
    for group_data in seed_data.get("groups", []):
        group_key = group_data["key"]
        popup_key = group_data["popup_key"]
        popup = popup_map.get(popup_key)
        if not popup:
            logger.warning(
                f"Popup {popup_key} not found for group {group_data['name']}"
            )
            continue

        existing_group = session.exec(
            select(Groups).where(
                Groups.slug == group_data["slug"], Groups.popup_id == popup.id
            )
        ).first()
        if existing_group:
            group_map[group_key] = existing_group
        else:
            group = Groups(
                tenant_id=tenant_id,
                popup_id=popup.id,
                name=group_data["name"],
                slug=group_data["slug"],
                description=group_data.get("description"),
                discount_percentage=Decimal(group_data.get("discount_percentage", "0")),
                max_members=group_data.get("max_members"),
                welcome_message=group_data.get("welcome_message"),
            )
            session.add(group)
            session.commit()
            session.refresh(group)
            group_map[group_key] = group
            logger.info(f"Group created: {group.name} ({group_key})")

    # Add leaders and members to groups
    for group_data in seed_data.get("groups", []):
        group_key = group_data["key"]
        group = group_map.get(group_key)
        if not group:
            continue

        for leader_key in group_data.get("leader_keys", []):
            human = human_map.get(leader_key)
            if human:
                existing_leader = session.exec(
                    select(GroupLeaders).where(
                        GroupLeaders.group_id == group.id,
                        GroupLeaders.human_id == human.id,
                    )
                ).first()
                if not existing_leader:
                    leader_link = GroupLeaders(
                        tenant_id=tenant_id,
                        group_id=group.id,
                        human_id=human.id,
                    )
                    session.add(leader_link)
                    session.commit()
                    logger.info(f"Added {leader_key} as leader to {group_key}")

        for member_key in group_data.get("member_keys", []):
            human = human_map.get(member_key)
            if human:
                existing_member = session.exec(
                    select(GroupMembers).where(
                        GroupMembers.group_id == group.id,
                        GroupMembers.human_id == human.id,
                    )
                ).first()
                if not existing_member:
                    member_link = GroupMembers(
                        tenant_id=tenant_id,
                        group_id=group.id,
                        human_id=human.id,
                    )
                    session.add(member_link)
                    session.commit()
                    logger.info(f"Added {member_key} as member to {group_key}")

    return group_map


def _seed_applications(
    session: Session,
    seed_data: dict,
    popup_map: dict,
    human_map: dict,
    group_map: dict,
    product_map: dict,
    tenant_id,
) -> tuple[dict, dict]:
    from app.models import Applications, AttendeeProducts, Attendees

    application_map: dict[str, Applications] = {}
    attendee_lists: dict[str, list[Attendees]] = {}

    for app_data in seed_data.get("applications", []):
        app_key = app_data["key"]
        popup_key = app_data["popup_key"]
        human_key = app_data["human_key"]

        popup = popup_map.get(popup_key)
        human = human_map.get(human_key)

        if not popup or not human:
            logger.warning(f"Popup or human not found for application {app_key}")
            continue

        existing_app = session.exec(
            select(Applications).where(
                Applications.human_id == human.id, Applications.popup_id == popup.id
            )
        ).first()
        if existing_app:
            application_map[app_key] = existing_app
            existing_attendees = session.exec(
                select(Attendees).where(Attendees.application_id == existing_app.id)
            ).all()
            attendee_lists[app_key] = list(existing_attendees)
            continue

        group_id = None
        if app_data.get("group_key"):
            group = group_map.get(app_data["group_key"])
            if group:
                group_id = group.id

        submitted_at = None
        accepted_at = None
        status = app_data.get("status", "draft")
        if status in ["in review", "accepted", "rejected"]:
            submitted_at = datetime.now(UTC)
        if status == "accepted":
            accepted_at = datetime.now(UTC)

        application = Applications(
            tenant_id=tenant_id,
            popup_id=popup.id,
            human_id=human.id,
            group_id=group_id,
            referral=app_data.get("referral"),
            status=status,
            custom_fields=app_data.get("custom_fields", {}),
            submitted_at=submitted_at,
            accepted_at=accepted_at,
        )
        session.add(application)
        session.commit()
        session.refresh(application)
        application_map[app_key] = application
        logger.info(f"Application created: {app_key} ({application.status})")

        attendees_data = app_data.get("attendees", [])
        created_attendees: list[Attendees] = []

        # Build a key→category_id map for this popup so we can set category_id
        # on each attendee. The attendees.category string column was dropped in PR 2.
        from app.api.attendee_category.models import AttendeeCategories  # noqa: PLC0415

        popup_categories = session.exec(
            select(AttendeeCategories).where(AttendeeCategories.popup_id == popup.id)
        ).all()
        category_key_to_id = {cat.key: cat.id for cat in popup_categories}

        for attendee_data in attendees_data:
            attendee_human_id = None
            cat_key = attendee_data.get("category")
            if (
                cat_key == "main"
                and attendee_data.get("email", "").lower() == human.email.lower()
            ):
                attendee_human_id = human.id

            category_id = category_key_to_id.get(cat_key) if cat_key else None

            attendee = Attendees(
                tenant_id=tenant_id,
                application_id=application.id,
                popup_id=popup.id,
                human_id=attendee_human_id,
                name=attendee_data["name"],
                category_id=category_id,
                email=attendee_data.get("email"),
                gender=attendee_data.get("gender"),
            )
            session.add(attendee)
            session.commit()
            session.refresh(attendee)
            created_attendees.append(attendee)

            for prod_data in attendee_data.get("products", []):
                product_slug = prod_data["product_slug"]
                product_map_key = f"{popup_key}:{product_slug}"
                product = product_map.get(product_map_key)
                if product:
                    from app.api.attendee.crud import generate_check_in_code

                    quantity = prod_data.get("quantity", 1)
                    for _ in range(quantity):
                        attendee_product = AttendeeProducts(
                            id=uuid.uuid4(),
                            tenant_id=tenant_id,
                            attendee_id=attendee.id,
                            product_id=product.id,
                            check_in_code=generate_check_in_code(""),
                        )
                        session.add(attendee_product)
                    session.commit()
                else:
                    logger.warning(
                        f"Product {product_slug} not found for attendee {attendee.name}"
                    )

            logger.info(f"Attendee created: {attendee.name} ({cat_key or 'unknown'})")

        attendee_lists[app_key] = created_attendees

    return application_map, attendee_lists


def _seed_payments(
    session: Session,
    seed_data: dict,
    popup_map: dict,
    application_map: dict,
    attendee_lists: dict,
    product_map: dict,
    coupon_map: dict,
    tenant_id,
) -> None:
    from app.models import PaymentProducts, Payments, Popups

    for payment_data in seed_data.get("payments", []):
        app_key = payment_data["application_key"]
        application = application_map.get(app_key)
        if not application:
            logger.warning(f"Application {app_key} not found for payment")
            continue

        existing_payment = session.exec(
            select(Payments).where(
                Payments.application_id == application.id,
                Payments.external_id == payment_data.get("external_id"),
            )
        ).first()
        if existing_payment:
            continue

        popup = session.get(Popups, application.popup_id)
        if not popup:
            continue

        popup_key = None
        for key, p in popup_map.items():
            if p.id == popup.id:
                popup_key = key
                break
        if not popup_key:
            continue

        coupon_id = None
        if payment_data.get("coupon_code"):
            coupon_map_key = f"{popup_key}:{payment_data['coupon_code'].upper()}"
            coupon = coupon_map.get(coupon_map_key)
            if coupon:
                coupon_id = coupon.id

        group_id = application.group_id

        payment = Payments(
            tenant_id=tenant_id,
            application_id=application.id,
            popup_id=application.popup_id,
            status=payment_data.get("status", "pending"),
            amount=Decimal(payment_data.get("amount", "0")),
            currency=payment_data.get("currency", "USD"),
            settlement_currency=payment_data.get("settlement_currency"),
            source=payment_data.get("source"),
            external_id=payment_data.get("external_id"),
            coupon_id=coupon_id,
            coupon_code=payment_data.get("coupon_code"),
            discount_value=(
                Decimal(payment_data["discount_value"])
                if payment_data.get("discount_value")
                else None
            ),
            group_id=group_id,
        )
        session.add(payment)
        session.commit()
        session.refresh(payment)
        logger.info(f"Payment created for {app_key}: {payment.status}")

        attendees = attendee_lists.get(app_key, [])
        for prod_data in payment_data.get("products", []):
            product_slug = prod_data["product_slug"]
            attendee_index = prod_data["attendee_index"]
            quantity = prod_data.get("quantity", 1)

            product_map_key = f"{popup_key}:{product_slug}"
            product = product_map.get(product_map_key)

            if not product:
                logger.warning(f"Product {product_slug} not found for payment")
                continue

            if attendee_index >= len(attendees):
                logger.warning(
                    f"Attendee index {attendee_index} out of range for {app_key}"
                )
                continue

            attendee = attendees[attendee_index]

            existing_pp = session.exec(
                select(PaymentProducts).where(
                    PaymentProducts.payment_id == payment.id,
                    PaymentProducts.product_id == product.id,
                    PaymentProducts.attendee_id == attendee.id,
                )
            ).first()
            if existing_pp:
                continue

            payment_product = PaymentProducts(
                tenant_id=tenant_id,
                payment_id=payment.id,
                product_id=product.id,
                attendee_id=attendee.id,
                quantity=quantity,
                product_name=product.name,
                product_description=product.description,
                product_price=product.price,
                product_category=product.category,
                product_currency="USD",
            )
            session.add(payment_product)
            session.commit()


def _seed_accommodation_step(session: Session, popup) -> None:
    """Point the popup's housing step at the accommodation-booking template.

    A popup without an *enabled* step on that template cannot sell rooms at
    all (the backend refuses the lines, not just the UI), so seeded
    inventory with no step would look broken. Only the seeded ``housing``
    step is retargeted, and only while it still carries the legacy
    ``housing-date`` template: an operator who configured the step by hand
    keeps whatever they chose.
    """
    from app.api.accommodation.constants import (
        ACCOMMODATION_STEP_TEMPLATE,
        HOUSING_STEP_TYPE,
    )
    from app.models import TicketingSteps

    already = session.exec(
        select(TicketingSteps).where(
            TicketingSteps.popup_id == popup.id,
            TicketingSteps.template == ACCOMMODATION_STEP_TEMPLATE,
        )
    ).first()
    if already:
        return

    step = session.exec(
        select(TicketingSteps).where(
            TicketingSteps.popup_id == popup.id,
            TicketingSteps.step_type == HOUSING_STEP_TYPE,
            TicketingSteps.template == "housing-date",
        )
    ).first()
    if not step:
        logger.warning(f"No housing step to retarget for {popup.slug}")
        return

    step.title = "Accommodation"
    step.description = "Optional: book a room for the nights you are staying"
    step.template = ACCOMMODATION_STEP_TEMPLATE
    # Empty property_ids means "every property this popup has", which is what
    # a demo wants; the picker in the backoffice narrows it from there.
    step.template_config = {"property_ids": [], "require_guest_names": True}
    step.is_enabled = True
    session.add(step)
    session.commit()
    logger.info(f"Accommodation step enabled for {popup.slug}")


def _seed_accommodations(
    session: Session, seed_data: dict, popup_map: dict, tenant_id
) -> dict:
    """Seed lodging inventory: photo bank, properties, room types and units.

    Everything goes through the accommodation CRUD rather than being inserted
    row by row, because each room type also needs its shadow ``Products``
    row. Inventory written behind the CRUD's back is invisible to checkout.
    """
    from app.api.accommodation import crud as accommodation_crud
    from app.api.accommodation.models import (
        AccommodationImages,
        AccommodationPriceRules,
        AccommodationProperties,
        Accommodations,
    )
    from app.api.accommodation.schemas import (
        AccommodationCreate,
        AccommodationImageCreate,
        AccommodationPriceRuleCreate,
        AccommodationPropertyCreate,
        AccommodationUnitBulkCreate,
    )

    def _popup(entry: dict, what: str):
        popup = popup_map.get(entry["popup_key"])
        if not popup:
            logger.warning(f"Popup {entry['popup_key']} not found for {what}")
        return popup

    image_map: dict[str, uuid.UUID] = {}
    for image_data in seed_data.get("accommodation_images", []):
        popup = _popup(image_data, f"image {image_data['key']}")
        if not popup:
            continue
        existing_image = session.exec(
            select(AccommodationImages).where(
                AccommodationImages.popup_id == popup.id,
                AccommodationImages.url == image_data["url"],
            )
        ).first()
        if existing_image:
            image_map[image_data["key"]] = existing_image.id
            continue
        image = accommodation_crud.accommodation_images_crud.create_for_tenant(
            session,
            AccommodationImageCreate(
                popup_id=popup.id,
                url=image_data["url"],
                filename=image_data.get("filename"),
                width=image_data.get("width"),
                height=image_data.get("height"),
            ),
            tenant_id,
        )
        image_map[image_data["key"]] = image.id

    property_map: dict[str, AccommodationProperties] = {}
    for property_data in seed_data.get("accommodation_properties", []):
        popup = _popup(property_data, f"property {property_data['name']}")
        if not popup:
            continue
        existing_property = session.exec(
            select(AccommodationProperties).where(
                AccommodationProperties.popup_id == popup.id,
                AccommodationProperties.name == property_data["name"],
            )
        ).first()
        if existing_property:
            property_map[property_data["key"]] = existing_property
            continue
        tax = property_data.get("tax_percentage")
        property_row = (
            accommodation_crud.accommodation_properties_crud.create_for_tenant(
                session,
                AccommodationPropertyCreate(
                    popup_id=popup.id,
                    name=property_data["name"],
                    address=property_data.get("address"),
                    description=property_data.get("description"),
                    contact_name=property_data.get("contact_name"),
                    contact_email=property_data.get("contact_email"),
                    tax_percentage=Decimal(tax) if tax else None,
                    sort_order=property_data.get("sort_order", 0),
                ),
                tenant_id,
            )
        )
        property_map[property_data["key"]] = property_row
        logger.info(f"Accommodation property created: {property_row.name}")

    seeded_popups = {}
    accommodation_map: dict[str, Accommodations] = {}
    for room_data in seed_data.get("accommodations", []):
        popup = _popup(room_data, f"accommodation {room_data['name']}")
        if not popup:
            continue
        property_row = property_map.get(room_data["property_key"])
        if not property_row:
            logger.warning(
                f"Property {room_data['property_key']} not found for "
                f"accommodation {room_data['name']}"
            )
            continue
        seeded_popups[popup.id] = popup

        existing_room = session.exec(
            select(Accommodations).where(
                Accommodations.popup_id == popup.id,
                Accommodations.property_id == property_row.id,
                Accommodations.name == room_data["name"],
            )
        ).first()
        if existing_room:
            room = existing_room
        else:
            long_stay = room_data.get("long_stay_price")
            room = accommodation_crud.accommodations_crud.create_for_tenant(
                session,
                AccommodationCreate(
                    popup_id=popup.id,
                    property_id=property_row.id,
                    name=room_data["name"],
                    kind=room_data.get("kind", "room"),
                    description=room_data.get("description"),
                    guest_capacity=room_data.get("guest_capacity", 1),
                    beds=room_data.get("beds", []),
                    default_nightly_price=Decimal(room_data["default_nightly_price"]),
                    long_stay_price=Decimal(long_stay) if long_stay else None,
                    min_stay_override=room_data.get("min_stay_override"),
                    bookable_from=room_data["bookable_from"],
                    bookable_to=room_data["bookable_to"],
                    sort_order=room_data.get("sort_order", 0),
                    image_ids=[
                        image_map[key]
                        for key in room_data.get("image_keys", [])
                        if key in image_map
                    ],
                ),
                tenant_id,
            )
            logger.info(f"Accommodation created: {property_row.name} / {room.name}")

        # bulk_create skips labels that already exist, so this is a no-op on
        # a second run and additive when the seed grows.
        accommodation_crud.accommodation_units_crud.bulk_create(
            session,
            room,
            AccommodationUnitBulkCreate(labels=room_data.get("unit_labels", [])),
        )

        accommodation_map[room_data["key"]] = room

        for rule_data in room_data.get("price_rules", []):
            existing_rule = session.exec(
                select(AccommodationPriceRules).where(
                    AccommodationPriceRules.accommodation_id == room.id,
                    AccommodationPriceRules.label == rule_data.get("label"),
                )
            ).first()
            if existing_rule:
                continue
            accommodation_crud.accommodation_price_rules_crud.create_for_accommodation(
                session,
                room,
                AccommodationPriceRuleCreate(
                    label=rule_data.get("label"),
                    start_date=rule_data["start_date"],
                    end_date=rule_data["end_date"],
                    nightly_price=Decimal(rule_data["nightly_price"]),
                    priority=rule_data.get("priority", 0),
                ),
            )

    for popup in seeded_popups.values():
        _seed_accommodation_step(session, popup)

    return accommodation_map


class _SeedBookingLine:
    """The shape ``accommodation_payments`` reads off a purchase line.

    The real callers pass a ``PaymentProductRequest``; the seed only needs the
    four attributes that module touches, and building the real schema here
    would drag in attendee validation the seed has already done.
    """

    def __init__(self, product_id, attendee_id, purchase_metadata) -> None:
        self.product_id = product_id
        self.attendee_id = attendee_id
        self.quantity = 1
        self.purchase_metadata = purchase_metadata


def _seed_accommodation_bookings(
    session: Session,
    seed_data: dict,
    popup_map: dict,
    accommodation_map: dict,
    application_map: dict,
    attendee_lists: dict,
    tenant_id,
) -> None:
    """Fill the calendar: sold stays, a hold, staff bookings and blocks.

    A purchase is built the way the checkout builds one (quote, payment,
    confirmed booking, pass) because the parts that make it *look* right in
    the backoffice (the price snapshot, the unit label frozen on the payment
    line) are produced by that path and by nothing else. Staff bookings and
    blocks skip it: they have no payment by definition.
    """
    from datetime import date, timedelta

    from fastapi import HTTPException

    from app.api.accommodation import payments as accommodation_payments
    from app.api.accommodation.availability import (
        AccommodationUnavailableError,
        create_booking,
    )
    from app.api.accommodation.constants import (
        PURCHASE_METADATA_KIND,
        BookingKind,
        BookingStatus,
    )
    from app.api.accommodation.models import AccommodationBookings, AccommodationUnits
    from app.api.attendee.crud import generate_check_in_code
    from app.api.payment.schemas import PaymentStatus
    from app.api.product.schemas import CATEGORY_HOUSING
    from app.models import AttendeeProducts, PaymentProducts, Payments

    def _already_seeded(accommodation, entry: dict) -> bool:
        """Match on what the entry pins down, so a re-run adds nothing.

        Blocks are identified by the *unit* they take off the market: two
        rooms out for the same repaint are two entries with the same note and
        the same dates, and matching on the note alone would seed only one.
        Guest stays are identified by the name on the booking.
        """
        statement = select(AccommodationBookings).where(
            AccommodationBookings.accommodation_id == accommodation.id,
            AccommodationBookings.check_in == date.fromisoformat(entry["check_in"]),
            AccommodationBookings.check_out == date.fromisoformat(entry["check_out"]),
        )
        rows = session.exec(statement).all()
        if entry["mode"] == "block":
            # Pinned to a unit: that unit is the identity, because two rooms
            # out for the same repair share a note and a date range. Left to
            # the assigner: the note is all there is, and comparing the unit
            # would be comparing against None and re-seeding forever.
            if entry.get("unit_label"):
                unit_id = _unit_id(accommodation, entry["unit_label"])
                return any(row.unit_id == unit_id for row in rows)
            return any(row.notes == entry.get("notes") for row in rows)
        return any(row.primary_guest_name == _primary_name(entry) for row in rows)

    def _primary_name(entry: dict) -> str | None:
        guests = entry.get("guests") or []
        return entry.get("primary_guest_name") or (guests[0] if guests else None)

    def _unit_id(accommodation, label: str | None):
        if not label:
            return None
        unit = session.exec(
            select(AccommodationUnits).where(
                AccommodationUnits.accommodation_id == accommodation.id,
                AccommodationUnits.label == label,
            )
        ).first()
        if unit is None:
            logger.warning(f"Unit {label} not found on {accommodation.name}")
        return unit.id if unit else None

    for entry in seed_data.get("accommodation_bookings", []):
        popup = popup_map.get(entry["popup_key"])
        accommodation = accommodation_map.get(entry["accommodation_key"])
        if not popup or not accommodation:
            logger.warning(f"Cannot seed booking {entry['key']}: missing inventory")
            continue
        if _already_seeded(accommodation, entry):
            continue

        check_in = date.fromisoformat(entry["check_in"])
        check_out = date.fromisoformat(entry["check_out"])
        mode = entry["mode"]

        if mode in ("staff", "block"):
            is_block = mode == "block"
            try:
                create_booking(
                    session,
                    accommodation=accommodation,
                    check_in=check_in,
                    check_out=check_out,
                    status=BookingStatus.CONFIRMED,
                    kind=BookingKind.BLOCK if is_block else BookingKind.GUEST,
                    unit_id=_unit_id(accommodation, entry.get("unit_label")),
                    guest_count=entry.get("guest_count"),
                    primary_guest_name=None if is_block else _primary_name(entry),
                    primary_guest_email=entry.get("primary_guest_email"),
                    notes=entry.get("notes"),
                )
            except AccommodationUnavailableError:
                session.rollback()
                logger.warning(f"No free unit for booking {entry['key']}; skipped")
                continue
            session.commit()
            logger.info(f"Accommodation {mode} seeded: {entry['key']}")
            continue

        application = application_map.get(entry["application_key"])
        attendees = attendee_lists.get(entry["application_key"], [])
        attendee_index = entry.get("attendee_index", 0)
        if not application or attendee_index >= len(attendees):
            logger.warning(f"Cannot seed booking {entry['key']}: missing applicant")
            continue
        attendee = attendees[attendee_index]

        guests = [{"name": name} for name in entry.get("guests", [])]
        line = _SeedBookingLine(
            product_id=accommodation.product_id,
            attendee_id=attendee.id,
            purchase_metadata={
                "kind": PURCHASE_METADATA_KIND,
                "accommodation_id": str(accommodation.id),
                "check_in": entry["check_in"],
                "check_out": entry["check_out"],
                "guest_count": len(guests) or entry.get("guest_count"),
                "guests": guests,
            },
        )

        # Prices the stay and rewrites the line's metadata with the quote and
        # the frozen names, exactly as a real checkout would.
        try:
            resolved = accommodation_payments.resolve_lines(session, popup, [line])
        except Exception as exc:  # noqa: BLE001 - a bad seed entry is not fatal
            logger.warning(f"Cannot seed booking {entry['key']}: {exc}")
            continue

        quote = resolved[0].quote
        cancelled = mode == "cancelled"
        confirmed = mode == "purchase"
        payment = Payments(
            tenant_id=tenant_id,
            application_id=application.id,
            popup_id=popup.id,
            status=(
                PaymentStatus.APPROVED.value
                if confirmed
                else PaymentStatus.CANCELLED.value
                if cancelled
                else PaymentStatus.PENDING.value
            ),
            amount=quote.total,
            currency=popup.currency,
            external_id=f"seed_{entry['key']}",
            group_id=application.group_id,
        )
        session.add(payment)
        session.flush()

        try:
            bookings = accommodation_payments.create_holds(
                session,
                payment_id=payment.id,
                resolved=resolved,
                lines=[line],
                hold_expires_at=(
                    None if confirmed else datetime.now(UTC) + timedelta(minutes=30)
                ),
                human_id=application.human_id,
                buyer_email=attendee.email,
                confirmed=confirmed,
            )
        except HTTPException:
            # The rooms ran out. One over-ambitious demo entry is not a reason
            # for the whole stack to refuse to start.
            session.rollback()
            logger.warning(f"No free unit for booking {entry['key']}; skipped")
            continue

        payment_product = PaymentProducts(
            tenant_id=tenant_id,
            payment_id=payment.id,
            product_id=accommodation.product_id,
            attendee_id=attendee.id,
            quantity=1,
            product_name=accommodation.name,
            product_description=accommodation.description,
            product_price=accommodation.default_nightly_price,
            product_category=CATEGORY_HOUSING,
            product_currency=popup.currency,
            effective_unit_price=quote.total,
            purchase_metadata=line.purchase_metadata,
        )
        session.add(payment_product)
        session.flush()
        accommodation_payments.attach_payment_products(
            session, payment_id=payment.id, bookings=bookings
        )

        if confirmed:
            # The pass is what the portal reads; without it the guest has paid
            # for a stay they cannot see.
            session.add(
                AttendeeProducts(
                    tenant_id=tenant_id,
                    attendee_id=attendee.id,
                    product_id=accommodation.product_id,
                    check_in_code=generate_check_in_code(""),
                    payment_id=payment.id,
                    purchase_metadata=line.purchase_metadata,
                )
            )
            for booking in bookings:
                booking.attendee_id = attendee.id
                session.add(booking)
        elif cancelled:
            accommodation_payments.release_for_payment(
                session, payment.id, cancelled=True
            )

        session.commit()
        logger.info(f"Accommodation {mode} seeded: {entry['key']}")


def init_db(session: Session) -> None:
    seed_data = _load_seed_data()

    _seed_superadmin(session)
    demo_tenant = _seed_tenant(session, seed_data)
    tenant_id = demo_tenant.id

    _seed_users(session, seed_data, tenant_id)

    popup_map = _seed_popups(session, seed_data, tenant_id)
    _seed_base_field_configs(session, popup_map, tenant_id)
    _seed_ticketing_steps(session, popup_map, tenant_id)
    _seed_approval_strategies(session, popup_map, tenant_id)

    attendee_category_map = _seed_attendee_categories(
        session, seed_data, popup_map, tenant_id
    )
    product_map = _seed_products(
        session, seed_data, popup_map, tenant_id, attendee_category_map
    )
    accommodation_map = _seed_accommodations(session, seed_data, popup_map, tenant_id)
    section_map = _seed_form_sections(session, seed_data, popup_map, tenant_id)
    _seed_form_fields(session, seed_data, popup_map, section_map, tenant_id)

    coupon_map = _seed_coupons(session, seed_data, popup_map, tenant_id)
    human_map = _seed_humans(session, seed_data, tenant_id)
    group_map = _seed_groups(session, seed_data, popup_map, human_map, tenant_id)

    application_map, attendee_lists = _seed_applications(
        session, seed_data, popup_map, human_map, group_map, product_map, tenant_id
    )
    _seed_payments(
        session,
        seed_data,
        popup_map,
        application_map,
        attendee_lists,
        product_map,
        coupon_map,
        tenant_id,
    )

    # After the applications: a sold stay needs the attendee its pass is
    # issued to.
    _seed_accommodation_bookings(
        session,
        seed_data,
        popup_map,
        accommodation_map,
        application_map,
        attendee_lists,
        tenant_id,
    )

    logger.info("Seed data initialization complete!")
