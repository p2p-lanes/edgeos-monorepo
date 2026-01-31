import json
from decimal import Decimal
from pathlib import Path

from loguru import logger
from sqlmodel import Session, create_engine, select

from app.api.shared.enums import UserRole
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


def init_db(session: Session) -> None:
    from app.core.tenant_db import ensure_tenant_credentials
    from app.models import Popups, Products, Tenants, Users

    seed_data = _load_seed_data()

    user = session.exec(select(Users).where(Users.email == settings.SUPERADMIN)).first()
    if not user:
        user = Users(
            email=settings.SUPERADMIN,
            role=UserRole.SUPERADMIN,
        )
        session.add(user)
        session.commit()
        logger.info(f"Superadmin created: {settings.SUPERADMIN}")

    # Create demo tenant from seed data
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

    # Create demo popup from seed data
    popup_data = seed_data["popup"]
    demo_popup = session.exec(
        select(Popups).where(
            Popups.slug == popup_data["slug"], Popups.tenant_id == demo_tenant.id
        )
    ).first()
    if not demo_popup:
        demo_popup = Popups(
            tenant_id=demo_tenant.id,
            name=popup_data["name"],
            slug=popup_data["slug"],
            status=popup_data.get("status", "draft"),
            requires_approval=popup_data.get("requires_approval", False),
            allows_spouse=popup_data.get("allows_spouse", False),
            allows_children=popup_data.get("allows_children", False),
            allows_coupons=popup_data.get("allows_coupons", False),
        )
        session.add(demo_popup)
        session.commit()
        session.refresh(demo_popup)
        logger.info(f"Demo popup created: {demo_popup.id}")

    # Create demo users from seed data
    users_data = seed_data["users"]
    for user_key, user_data in users_data.items():
        existing_user = session.exec(
            select(Users).where(
                Users.email == user_data["email"], Users.tenant_id == demo_tenant.id
            )
        ).first()
        if not existing_user:
            new_user = Users(
                email=user_data["email"],
                full_name=user_data.get("full_name"),
                role=UserRole(user_data["role"]),
                tenant_id=demo_tenant.id,
            )
            session.add(new_user)
            session.commit()
            logger.info(f"Demo {user_key} user created: {user_data['email']}")

    # Create demo product from seed data
    product_data = seed_data["product"]
    demo_product = session.exec(
        select(Products).where(
            Products.slug == product_data["slug"], Products.popup_id == demo_popup.id
        )
    ).first()
    if not demo_product:
        demo_product = Products(
            tenant_id=demo_tenant.id,
            popup_id=demo_popup.id,
            name=product_data["name"],
            slug=product_data["slug"],
            price=Decimal(product_data["price"]),
            description=product_data.get("description"),
            category=product_data.get("category"),
            attendee_category=product_data.get("attendee_category"),
            is_active=product_data.get("is_active", True),
            exclusive=product_data.get("exclusive", False),
        )
        session.add(demo_product)
        session.commit()
        logger.info(f"Demo product created: {demo_product.id}")
