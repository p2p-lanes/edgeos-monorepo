"""Idempotent seed for a local Amanita test merchant.

Mirrors the production Amanita Festival 2026 popup config captured 2026-05-12
from the live backoffice — six ticketing steps (Tickets → Alojamiento →
Aftermovie → Galería → FAQs → Confirmar), ~10 products, theme tokens, and
the gold accent the user asked for in the audio.

Run from the backend container:

    docker compose exec backend python scripts/seed_amanita.py

Or locally (after `uv sync`):

    cd backend && uv run python scripts/seed_amanita.py

Re-running is safe — every insert checks for an existing row first.
"""

from __future__ import annotations

import sys
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

# Make `app.*` importable when running as a standalone script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from loguru import logger  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

from app.api.shared.enums import UserRole  # noqa: E402
from app.core.db import engine  # noqa: E402

TENANT_SLUG = "amanita-test"
TENANT_NAME = "Amanita Test"
ADMIN_EMAIL = "aromeoes@gmail.com"
POPUP_SLUG = "amanita-festival-2026"
POPUP_NAME = "Amanita Festival 2026"

# Verde-marino + dorado palette extracted from tickets.amanitafestival.com.
THEME_CONFIG: dict = {
    "colors": {
        "mode": "dark",
        "primary_color": "#071b28",
        "primary_foreground_color": "#ffffff",
        "accent_color": "#A89477",
        "checkout_subtitle_color": "rgba(255, 255, 255, 0.85)",
    }
}

# Source: AMANITA_CONFIG.md captured from prod backoffice 2026-05-12.
# Estacionamiento (parking) added per the requirements list (req #12) — uses
# the existing housing-date template; no new step type needed.
PRODUCTS = [
    # Tickets
    {"name": "Ticket 4 Días - Early Bird", "slug": "ticket-4-dias-early-bird",
     "price": "205000.00", "category": "ticket", "attendee_category": "main"},
    {"name": "Ticket 4 Días - Preventa I", "slug": "ticket-4-dias-preventa-i",
     "price": "215000.00", "category": "ticket", "attendee_category": "main"},
    {"name": "Ticket 7 Días - Experiencia Extendida - Early Bird",
     "slug": "ticket-7-dias-experiencia-extendida-early-bird",
     "price": "235000.00", "category": "ticket", "attendee_category": "main"},
    {"name": "Ticket 7 Días - Experiencia Extendida - Preventa I",
     "slug": "ticket-7-dias-experiencia-extendida-preventa-i",
     "price": "255000.00", "category": "ticket", "attendee_category": "main"},
    {"name": "Entrada Niños 2026 (0 a 6 años)", "slug": "entrada-ninos-2026-0-6",
     "price": "10000.00", "category": "ticket", "attendee_category": "kid"},
    {"name": "Entrada Niños 2026 (7 a 12 años)", "slug": "entrada-ninos-2026-7-12",
     "price": "80000.00", "category": "ticket", "attendee_category": "kid"},
    # Housing
    {"name": "Glamping 2026", "slug": "glamping-2026", "price": "880000.00",
     "category": "housing", "attendee_category": "main"},
    {"name": "Derecho a Acampe 2026", "slug": "derecho-a-acampe-2026",
     "price": "45000.00", "category": "housing", "attendee_category": "main"},
    {"name": "Carpa + Colchon inflable doble", "slug": "carpa-colchon-inflable-doble",
     "price": "290000.00", "category": "housing", "attendee_category": "main"},
    {"name": "Carpa + Colchon inflable simple x 2",
     "slug": "carpa-colchon-inflable-simple-x2", "price": "300000.00",
     "category": "housing", "attendee_category": "main"},
    {"name": "Espacio para Motorhome 2026", "slug": "espacio-motorhome-2026",
     "price": "150000.00", "category": "housing", "attendee_category": "main"},
    # Parking — sample categories exercised by the new Estacionamiento step.
    {"name": "Estacionamiento - Auto", "slug": "estacionamiento-auto",
     "price": "8000.00", "category": "parking", "attendee_category": "main"},
    {"name": "Estacionamiento - Auto compartido (2 personas)",
     "slug": "estacionamiento-auto-compartido", "price": "12000.00",
     "category": "parking", "attendee_category": "main"},
]


def _resolve_admin(session: Session, tenant_id: uuid.UUID) -> uuid.UUID | None:
    """Idempotently ensure a tenant admin exists.

    The `users.email` column is globally unique, so we can't create a
    second row for the same address in another tenant. If the SUPERADMIN
    already owns an account, we leave the membership to the existing
    superadmin user — they can already access every tenant — and skip the
    tenant-scoped admin creation.
    """
    from app.models import Users

    user = session.exec(
        select(Users).where(Users.email == ADMIN_EMAIL,
                            Users.tenant_id == tenant_id)
    ).first()
    if user:
        return user.id

    # SUPERADMIN may already exist in another tenant (e.g. the demo one).
    any_user = session.exec(
        select(Users).where(Users.email == ADMIN_EMAIL)
    ).first()
    if any_user:
        logger.info(
            f"{ADMIN_EMAIL} already exists (role={any_user.role}); "
            "skipping tenant-scoped admin creation"
        )
        return None

    user = Users(
        email=ADMIN_EMAIL,
        full_name="Amanita Admin",
        role=UserRole.ADMIN,
        tenant_id=tenant_id,
    )
    session.add(user)
    session.commit()
    session.refresh(user)
    logger.info(f"admin user {ADMIN_EMAIL} created for tenant {tenant_id}")
    return user.id


def _resolve_tenant(session: Session) -> uuid.UUID:
    from app.core.tenant_db import ensure_tenant_credentials
    from app.models import Tenants

    tenant = session.exec(
        select(Tenants).where(Tenants.slug == TENANT_SLUG)
    ).first()
    if tenant:
        return tenant.id

    tenant = Tenants(name=TENANT_NAME, slug=TENANT_SLUG)
    session.add(tenant)
    session.commit()
    session.refresh(tenant)
    ensure_tenant_credentials(session, tenant.id)
    logger.info(f"tenant {TENANT_SLUG} created: {tenant.id}")
    return tenant.id


def _resolve_popup(session: Session, tenant_id: uuid.UUID) -> uuid.UUID:
    from app.api.popup.schemas import (
        CheckoutMode,
        PopupStatus,
        SaleType,
    )
    from app.models import Popups

    popup = session.exec(
        select(Popups).where(
            Popups.tenant_id == tenant_id, Popups.slug == POPUP_SLUG
        )
    ).first()
    if popup:
        # Refresh theme config — convenient for iterating on tokens.
        if popup.theme_config != THEME_CONFIG:
            popup.theme_config = THEME_CONFIG
            session.add(popup)
            session.commit()
            logger.info(f"theme_config refreshed on {popup.slug}")
        return popup.id

    popup = Popups(
        tenant_id=tenant_id,
        name=POPUP_NAME,
        slug=POPUP_SLUG,
        tagline="4 días de música, arte, yoga y talleres",
        location="Mercedes, Pcia de Bs.As",
        status=PopupStatus.active,
        sale_type=SaleType.direct,
        checkout_mode=CheckoutMode.simple_quantity,
        start_date=datetime(2026, 11, 20, tzinfo=UTC),
        end_date=datetime(2026, 11, 24, tzinfo=UTC),
        currency="ARS",
        allows_spouse=False,
        allows_children=True,
        allows_coupons=True,
        default_language="es",
        supported_languages=["es", "en"],
        theme_config=THEME_CONFIG,
    )
    session.add(popup)
    session.commit()
    session.refresh(popup)
    logger.info(f"popup {POPUP_SLUG} created: {popup.id}")
    return popup.id


def _seed_products(
    session: Session, popup_id: uuid.UUID, tenant_id: uuid.UUID
) -> dict[str, uuid.UUID]:
    """Return slug → product_id map. Inserts missing products only."""
    from app.api.product.schemas import TicketAttendeeCategory
    from app.models import Products

    existing = session.exec(
        select(Products).where(Products.popup_id == popup_id)
    ).all()
    by_slug: dict[str, uuid.UUID] = {p.slug: p.id for p in existing}

    for product in PRODUCTS:
        if product["slug"] in by_slug:
            continue
        row = Products(
            tenant_id=tenant_id,
            popup_id=popup_id,
            name=product["name"],
            slug=product["slug"],
            price=Decimal(product["price"]),
            category=product["category"],
            attendee_category=TicketAttendeeCategory(product["attendee_category"]),
            is_active=True,
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        by_slug[row.slug] = row.id
        logger.info(f"product seeded: {row.slug}")
    return by_slug


def _seed_ticketing_steps(
    session: Session,
    popup_id: uuid.UUID,
    tenant_id: uuid.UUID,
    product_ids: dict[str, uuid.UUID],
) -> None:
    """Replace any existing steps with the Amanita-prod-shaped set.

    Idempotent: drops all existing rows for this popup before inserting,
    so re-running the seed always converges on the canonical config.
    """
    from app.models import TicketingSteps

    existing = session.exec(
        select(TicketingSteps).where(TicketingSteps.popup_id == popup_id)
    ).all()
    for row in existing:
        session.delete(row)
    session.commit()

    def pid(slug: str) -> str:
        return str(product_ids[slug])

    steps = [
        {
            "step_type": "tickets",
            "title": "Tickets",
            "description": "Tu entrada te brinda acceso a todas las actividades y servicios del festival.",
            "watermark": "Tickets",
            "show_title": False,
            "show_watermark": True,
            # New ticket-card template — section-level hero image (16:9 or 3:2),
            # one "Ver más" description per section, NO attendee-category
            # accordion ("Main" pill). See feedback memo.
            "template": "ticket-card",
            "template_config": {
                "variant": "stacked",
                "sections": [
                    {
                        "key": "ticket-4-dias",
                        "label": "Ticket 4 Días",
                        "image_url": "/amanita/ticket-4-dias.jpg",
                        "image_aspect": "16:9",
                        "description": (
                            "La entrada te brinda acceso a todas las "
                            "actividades, talleres, y shows durante los "
                            "cuatro días del festival.\n\nPodés ingresar "
                            "a partir del Jueves 19 de Noviembre a las 18hs.\n\n"
                            "⚠️ No hay devoluciones (sin excepción).\n"
                            "⚠️ Tickets transferibles hasta 30 de Octubre, 2026 "
                            "(sin excepción)."
                        ),
                        "order": 0,
                        "product_ids": [
                            pid("ticket-4-dias-early-bird"),
                            pid("ticket-4-dias-preventa-i"),
                        ],
                    },
                    {
                        "key": "ticket-7-dias",
                        "label": "Ticket 7 Días",
                        "image_url": "/amanita/ticket-7-dias.jpg",
                        "image_aspect": "16:9",
                        "description": (
                            "Experiencia extendida: 17 al 24 de Noviembre. "
                            "Incluye todas las actividades del festival más "
                            "los 3 días previos (Pre-Festival)."
                        ),
                        "order": 1,
                        "product_ids": [
                            pid("ticket-7-dias-experiencia-extendida-early-bird"),
                            pid("ticket-7-dias-experiencia-extendida-preventa-i"),
                        ],
                    },
                    {
                        "key": "entrada-ninos",
                        "label": "Entrada Niños",
                        "image_url": "/amanita/entrada-ninos.jpg",
                        "image_aspect": "3:2",
                        "description": (
                            "La entrada para niños es hasta los 12 años. "
                            "Es necesario que traigan su documento de "
                            "identidad y que estén acompañados por un adulto."
                        ),
                        "order": 2,
                        "product_ids": [
                            pid("entrada-ninos-2026-0-6"),
                            pid("entrada-ninos-2026-7-12"),
                        ],
                    },
                ],
            },
            "order": 0,
            "product_category": "ticket",
            "emoji": "🎟️",
        },
        {
            "step_type": "housing",
            "title": "Alojamiento",
            "description": "Podés venir por el día, pero dormir en el predio y compartir en comunidad es una parte fundamental de la experiencia",
            "watermark": "Alojamiento",
            "show_title": False,
            "show_watermark": True,
            "template": "housing-date",
            "template_config": {
                "design_variant": "grouped",
                "show_date_picker": False,
                "price_per_night": False,
                "sections": [
                    {
                        "key": "carpa-pre-armada",
                        "label": "Alquiler Carpa Pre Armada - 2 personas",
                        "description": "Hacemos que la experiencia de acampe sea más fácil y cómoda. Cuando llegues, te va a estar esperando tu carpa armada para 2 personas lista en el lugar!\n\nAdentro de la carpa, vas a encontrar un colchón inflable nuevo en su caja con el inflador. (Sí, vas a tener que inflar tu colchón. Tampoco podemos hacerlo tan fácil! 🤭)\n\nTraé tus sábanas, tu almohada y tu peluche preferido 🧸",
                        "order": 0,
                        "product_ids": [
                            pid("carpa-colchon-inflable-doble"),
                            pid("carpa-colchon-inflable-simple-x2"),
                        ],
                    },
                    {
                        "key": "motorhome",
                        "label": "Motorhome",
                        "description": "Reservá un espacio para venir con motorhome 🚙",
                        "order": 1,
                        "product_ids": [pid("espacio-motorhome-2026")],
                    },
                    {
                        "key": "glamping",
                        "label": "Glamping",
                        "description": "Experiencia premium con todas las comodidades.",
                        "order": 2,
                        "product_ids": [pid("glamping-2026")],
                    },
                    {
                        "key": "acampe",
                        "label": "Derecho a Acampe",
                        "description": "Traé tu propia carpa.",
                        "order": 3,
                        "product_ids": [pid("derecho-a-acampe-2026")],
                    },
                ],
            },
            "order": 1,
            "product_category": "housing",
            "footer_note": "*No hay reembolsos, sin excepción.\n• Entradas transferibles hasta el 30 de Octubre 2026, sin excepción.\n• Entrada con DNI y QR.",
            "emoji": "🏠",
        },
        {
            "step_type": "parking",
            "title": "Estacionamiento",
            "description": (
                "Reservá tu lugar de estacionamiento. Fomentamos el viaje "
                "compartido para reducir el impacto ambiental."
            ),
            "watermark": "Estacionamiento",
            "show_title": False,
            "show_watermark": True,
            "template": "housing-date",
            "template_config": {
                "variant": "compact",
                "show_date_picker": False,
                "price_per_night": False,
                "sections": [
                    {
                        "key": "auto",
                        "label": "Auto",
                        "image_url": "/amanita/parking-auto.jpg",
                        "description": "Lugar para un vehículo durante todo el festival.",
                        "order": 0,
                        "product_ids": [pid("estacionamiento-auto")],
                    },
                    {
                        "key": "auto-compartido",
                        "label": "Auto compartido",
                        "description": "Tarifa preferencial al venir con 2 o más personas.",
                        "order": 1,
                        "product_ids": [pid("estacionamiento-auto-compartido")],
                    },
                ],
            },
            "order": 2,
            "product_category": "parking",
            "emoji": "🅿️",
        },
        {
            "step_type": "experience",
            "title": "Aftermovie",
            "description": "",
            "watermark": "Aftermovie",
            "show_title": False,
            "show_watermark": True,
            "template": "youtube-video",
            "template_config": {
                "youtube_url": "https://www.youtube.com/watch?v=lhJQ55IRWhQ",
            },
            "order": 3,
            "emoji": "▶️",
        },
        {
            "step_type": "gallery",
            "title": "Galería",
            "description": "",
            "watermark": "Galería",
            "show_title": False,
            "show_watermark": False,
            "template": "image-gallery",
            "template_config": {
                "variant": "masonry",
                "images": [
                    {"id": "img1", "url": "/amanita/img1.jpg"},
                    {"id": "img2", "url": "/amanita/img2.jpg"},
                    {"id": "img3", "url": "/amanita/img3.jpg"},
                    {"id": "img4", "url": "/amanita/img4.jpg"},
                    {"id": "img5", "url": "/amanita/img5.jpg"},
                    {"id": "img6", "url": "/amanita/img6.jpg"},
                ],
            },
            "order": 4,
            "emoji": "🖼️",
        },
        {
            "step_type": "faqs",
            "title": "FAQs",
            "description": "",
            "watermark": "FAQs",
            "show_title": False,
            "show_watermark": False,
            "template": "faqs",
            "template_config": {
                "design_variant": "accordion",
                "items": [
                    {"question": "Dónde es Amanita?",
                     "answer": "Amanita va a ser en un entorno natural en Mercedes, Provincia de Buenos Aires, a unos 90 minutos de la ciudad. La ubicación exacta se compartirá más cerca de la fecha con quienes hayan adquirido su ticket, para preservar la intimidad del encuentro."},
                    {"question": "Qué incluye el ticket?",
                     "answer": "El ticket incluye acceso a los 4 o 7 días del festival y a todas las actividades y servicios de baños y duchas. Vas a poder disfrutar de más de 150 clases, talleres y charlas, y más de 100 shows de música en vivo durante toda la experiencia. Arte inmersivo y mucho más!"},
                    {"question": "Cómo llegar?",
                     "answer": "Auto (fomentamos el viaje compartido para reducir el impacto ambiental). Se puede adquirir estacionamiento. Cerca de la fecha armamos un grupo para viajes compartidos."},
                    {"question": "Se puede llevar comida?",
                     "answer": "Podés traer snacks y cosas para comer. Lo que no está permitido es hacer fuego o cocinar con gas dentro del predio. En Amanita vamos a tener una feria gastronómica con opciones saludables, veganas y sin TACC."},
                    {"question": "Si no puedo ir, puedo transferir mi ticket?",
                     "answer": "Sí, si no podés asistir, podés transferir tu ticket a otra persona, hasta el 30 de octubre del 2026 (sin excepción). Las entradas son con DNI y QR."},
                    {"question": "Se permiten mascotas?",
                     "answer": "Amamos a los animales, pero por razones de seguridad, higiene y cuidado del entorno, no se permite el ingreso con mascotas."},
                ],
            },
            "order": 5,
            "emoji": "❓",
        },
        {
            "step_type": "buyer",
            "title": "Tu información",
            "description": "Completá tus datos antes del pago.",
            "watermark": "Tu información",
            "show_title": False,
            "show_watermark": True,
            "template": "buyer-form",
            "order": 6,
            "protected": True,
            "emoji": "📝",
        },
        {
            "step_type": "confirm",
            "title": "Confirmar",
            "description": "Revisa tu pedido antes de pagar.",
            "watermark": "Confirmar",
            "show_title": False,
            "show_watermark": True,
            "order": 7,
            "protected": True,
            "emoji": "✅",
        },
    ]

    for step in steps:
        row = TicketingSteps(
            tenant_id=tenant_id,
            popup_id=popup_id,
            step_type=step["step_type"],
            title=step["title"],
            description=step.get("description"),
            watermark=step.get("watermark"),
            show_title=step.get("show_title", True),
            show_watermark=step.get("show_watermark", True),
            template=step.get("template"),
            template_config=step.get("template_config"),
            product_category=step.get("product_category"),
            order=step["order"],
            is_enabled=True,
            protected=step.get("protected", False),
            emoji=step.get("emoji"),
        )
        session.add(row)
    session.commit()
    logger.info(f"ticketing steps seeded ({len(steps)} steps) for {popup_id}")


def main() -> None:
    with Session(engine) as session:
        tenant_id = _resolve_tenant(session)
        _resolve_admin(session, tenant_id)
        popup_id = _resolve_popup(session, tenant_id)
        product_ids = _seed_products(session, popup_id, tenant_id)
        _seed_ticketing_steps(session, popup_id, tenant_id, product_ids)

    logger.info("amanita test merchant ready")
    logger.info(f"  tenant slug: {TENANT_SLUG}")
    logger.info(f"  popup slug:  {POPUP_SLUG}")
    logger.info(f"  portal URL:  http://localhost:3000/checkout/{POPUP_SLUG}")


if __name__ == "__main__":
    main()
