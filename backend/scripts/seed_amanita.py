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


def asset(name: str) -> str:
    """Build a portal-public asset URL.

    Images live in `portal/public/amanita/` so the path resolves directly
    from `/amanita/...` — no CDN, no cross-origin loading for SSR.
    """
    return f"/amanita/{name}"

# Verde-marino + dorado palette extracted from tickets.amanitafestival.com.
THEME_CONFIG: dict = {
    "colors": {
        "mode": "dark",
        "primary_color": "#071b28",
        "primary_foreground_color": "#ffffff",
        "accent_color": "#A89477",
        # Navbar: verde marino background with white text and white-tinted
        # monochrome emojis, matching the live production look on
        # amanita.edgeos.world. These tokens are tenant-configurable.
        "checkout_navbar_bg": "#071b28",
        "checkout_nav_text_color": "#ffffff",
        "checkout_nav_monochrome_emoji": True,
        "checkout_subtitle_color": "rgba(255, 255, 255, 0.85)",
        # Section watermark (giant title behind each step) — bright white
        # at 70% alpha so it reads on the dark forest background. Default
        # mix recipe nearly hides it on dark hero photos; this override
        # surfaces it without baking the colour into the portal.
        "checkout_watermark_color": "rgba(255, 255, 255, 0.7)",
        # Ticket-card surface — cream cards with deep-teal text, so each
        # section reads cleanly on top of the verde-marino backdrop. Only
        # applied to VariantTicketCard surfaces (buyer form / confirm
        # cards stay on the global dark palette).
        "card_background_color": "#f1ebe3",
        "card_foreground_color": "#004a5a",
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

    # Branding asset paths — served from portal/public/amanita. Copying real
    # images into the public dir (instead of pointing at the prod CDN) keeps
    # the test merchant fully self-contained and avoids cross-origin loading
    # for SSR.
    popup_assets = dict(
        image_url=asset("hero-flyer.png"),
        icon_url=asset("logo.png"),
        favicon_url=asset("logo.png"),
        express_checkout_background=asset("checkout-bg.webp"),
    )

    popup = session.exec(
        select(Popups).where(
            Popups.tenant_id == tenant_id, Popups.slug == POPUP_SLUG
        )
    ).first()
    if popup:
        # Re-apply branding/theme each run so tweaks to this script flow
        # back into the existing test merchant without needing a fresh DB.
        changed = False
        if popup.theme_config != THEME_CONFIG:
            popup.theme_config = THEME_CONFIG
            changed = True
        for attr, value in popup_assets.items():
            if getattr(popup, attr) != value:
                setattr(popup, attr, value)
                changed = True
        if changed:
            session.add(popup)
            session.commit()
            logger.info(f"branding refreshed on {popup.slug}")
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
        **popup_assets,
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

    # Hero markup matches the live Gemstore landing — date band + tagline +
    # bullet list + "3 Cuotas Sin Interés" payment badge. Rendered via the
    # rich-text content template so any tenant can author their own hero
    # without code changes.
    hero_html = """
<section class=\"flex flex-col items-center gap-4 py-2\">
  <h1 style=\"font-family: serif; letter-spacing: 0.35em; font-size: 2.5rem; margin: 0; color: white;\">AMANITA</h1>
  <p style=\"letter-spacing: 0.45em; font-size: 0.7rem; margin: 0; color: rgba(255,255,255,0.7);\">FESTIVAL</p>
  <div style=\"border-top: 1px solid #A89477; border-bottom: 1px solid #A89477; padding: 0.5rem 1.5rem; margin-top: 0.5rem;\">
    <p style=\"font-size: 0.8rem; letter-spacing: 0.1em; color: #A89477; margin: 0;\">20-24 DE NOVIEMBRE, 2026 · BS AS, ARGENTINA</p>
  </div>
  <h2 style=\"font-size: 1.25rem; font-weight: 600; letter-spacing: 0.05em; margin-top: 1rem; color: white;\">4 DÍAS DE MÚSICA, ARTE, YOGA Y TALLERES</h2>
  <p style=\"font-style: italic; color: rgba(255,255,255,0.8);\">Una celebración de amor, apertura y conexión</p>
  <div style=\"border: 1px solid #A89477; border-radius: 4px; padding: 1rem 2rem; margin-top: 1.5rem;\">
    <p style=\"font-size: 0.85rem; letter-spacing: 0.1em; color: #A89477; margin: 0; text-align: center;\">EXPERIENCIA EXTENDIDA<br/>17, 18 Y 19 DE NOVIEMBRE</p>
  </div>
  <ul style=\"list-style: none; padding: 0; margin-top: 1.5rem; color: rgba(255,255,255,0.95); line-height: 1.7;\">
    <li>¡Asegurá tu lugar al menor precio posible!</li>
    <li>+300 Artistas y Facilitadores</li>
    <li>+10 Escenarios</li>
    <li>Se parte de una experiencia única</li>
    <li>Mercedes, Pcia de Bs.As</li>
  </ul>
  <span style=\"display:inline-block; background:#A89477; color:#071b28; padding: 0.5rem 1.5rem; border-radius: 4px; font-weight: 600; font-size: 0.9rem; margin-top: 1rem;\">3 Cuotas Sin Interés 💳</span>
</section>
""".strip()

    # Step list. Buyer step intentionally at order 0 so "Tu información"
    # opens the funnel — per the user's recording ("hay que reordenar los
    # componentes como para que tu información sea lo primero").
    steps = [
        {
            "step_type": "buyer",
            "title": "Tu información",
            "description": "Completá tus datos antes de continuar.",
            "watermark": "Tu información",
            "show_title": False,
            "show_watermark": True,
            "template": "buyer-form",
            "order": 0,
            "protected": True,
            "emoji": "user",
        },
        {
            "step_type": "hero",
            "title": "Hero",
            "description": "",
            "watermark": "",
            "show_title": False,
            "show_watermark": False,
            "template": "rich-text",
            "template_config": {
                "html": hero_html,
                "alignment": "center",
                "max_width": "wide",
            },
            "order": 1,
            "emoji": "mushroom",
        },
        {
            "step_type": "tickets",
            "title": "Tickets",
            "description": "Tu entrada te brinda acceso a todas las actividades y servicios del festival.",
            "watermark": "Tickets",
            "show_title": False,
            "show_watermark": True,
            "template": "ticket-card",
            "template_config": {
                "variant": "stacked",
                # Light surface keeps the tickets readable on the dark
                # forest background — pinned regardless of the popup's
                # global theme mode (which is dark for hero/nav contrast).
                "surface": "theme",
                "sections": [
                    {
                        "key": "ticket-4-dias",
                        "label": "Ticket 4 Días",
                        "image_url": asset("ticket-4-dias.png"),
                        "image_aspect": "3:2",
                        # Full "Ver más" copy carried over verbatim from the
                        # live product description on the Gemstore landing.
                        "description": (
                            "La entrada te brinda acceso a todas las "
                            "actividades, talleres, y shows durante los "
                            "cuatro días del festival.\n\n"
                            "Podés participar de:\n"
                            "Amanita Festival: 20 al 24 de Noviembre, 2026.\n\n"
                            "Incluye:\n"
                            "⛺ Días repletos de actividades en Comunidad\n"
                            "🎵 Djs y Bandas en Vivo\n"
                            "🎨 Arte Inmersivo\n"
                            "🧘 Yoga, Meditación, Clases de Baile y Movimiento\n"
                            "🎭 Talleres Interactivos, Charlas y Paneles\n"
                            "Podés ingresar a partir del Jueves 19 de Noviembre "
                            "a las 18hs.\n\n"
                            "*El espacio de acampe, las comidas y el "
                            "estacionamiento no están incluidos.\n\n"
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
                        "image_url": asset("ticket-7-dias.png"),
                        "image_aspect": "3:2",
                        "description": (
                            "La entrada te brinda acceso a todas las "
                            "actividades, talleres, y shows durante los "
                            "siete días del festival.\n\n"
                            "Podés participar de:\n"
                            "Experiencia Extendida: 17, 18 y 19 de Noviembre, 2026\n"
                            "Amanita Festival: 20 al 24 de Noviembre, 2026.\n\n"
                            "Incluye:\n"
                            "⛺ Días repletos de actividades en Comunidad\n"
                            "🎵 Djs y Bandas en Vivo\n"
                            "🎨 Arte Inmersivo\n"
                            "🧘 Yoga, Meditación, Clases de Baile y Movimiento\n"
                            "🎭 Talleres Interactivos, Charlas y Paneles\n\n"
                            "*El espacio de acampe, las comidas y el "
                            "estacionamiento no están incluidos.\n\n"
                            "⚠️ No hay devoluciones (sin excepción).\n"
                            "⚠️ Tickets transferibles hasta 30 de Octubre, 2026 "
                            "(sin excepción)."
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
                        "image_url": asset("entrada-ninos.png"),
                        "image_aspect": "3:2",
                        "description": (
                            "La entrada para niños es hasta los 12 años. "
                            "Es necesario que traigan su documento de "
                            "identidad y que entren al evento acompañados "
                            "por sus responsables. A partir de los 13 años, "
                            "deberán pagar una entrada normal.\n\n"
                            "Entrada niños: 0 a 6 años\n"
                            "Entrada niños: 6 a 12 años\n\n"
                            "Importante:\n"
                            "Todo menor de 18 años debe estar acompañado por un "
                            "adulto responsable en todo momento sin excepción.\n\n"
                            "Incluye:\n"
                            "⛺ 4 Días repletos de actividades en Comunidad\n"
                            "🎵 Djs y Bandas en Vivo\n"
                            "🎨 Arte Inmersivo\n"
                            "🧘 Yoga, Meditación, Clases de Baile y Movimiento\n"
                            "🎭 Talleres Interactivos, Charlas y Paneles"
                        ),
                        "order": 2,
                        "product_ids": [
                            pid("entrada-ninos-2026-0-6"),
                            pid("entrada-ninos-2026-7-12"),
                        ],
                    },
                ],
            },
            "order": 2,
            "product_category": "ticket",
            "emoji": "ticket",
        },
        {
            "step_type": "housing",
            "title": "Alojamiento",
            "description": "Podés venir por el día, pero dormir en el predio y compartir en comunidad es una parte fundamental de la experiencia",
            "watermark": "Alojamiento",
            "show_title": False,
            "show_watermark": True,
            # ticket-card template gives us multi-product cart, no date
            # picker, no per-night multiplication — exactly the housing UX
            # the user asked for. Same template as Tickets keeps the visual
            # styling consistent.
            "template": "ticket-card",
            "template_config": {
                "variant": "stacked",
                "surface": "theme",
                "sections": [
                    {
                        "key": "carpa-pre-armada",
                        "label": "Alquiler Carpa Pre Armada - 2 personas",
                        "image_url": asset("housing-carpa.webp"),
                        "description": (
                            "Hacemos que la experiencia de acampe sea más fácil y "
                            "cómoda. Cuando llegues, te va a estar esperando tu "
                            "carpa armada para 2 personas lista en el lugar!\n\n"
                            "Adentro de la carpa, vas a encontrar un colchón "
                            "inflable nuevo en su caja con el inflador. (Sí, vas a "
                            "tener que inflar tu colchón. Tampoco podemos hacerlo "
                            "tan fácil! 🤭)\n\n"
                            "Traé tus sábanas, tu almohada y tu peluche "
                            "preferido 🧸"
                        ),
                        "order": 0,
                        "product_ids": [
                            pid("carpa-colchon-inflable-doble"),
                            pid("carpa-colchon-inflable-simple-x2"),
                        ],
                    },
                    {
                        "key": "motorhome",
                        "label": "Motorhome",
                        "image_url": asset("housing-motorhome.webp"),
                        "description": (
                            "Reservá un espacio para venir con motorhome 🚙\n\n"
                            "No se brinda servicio de agua, electricidad, ni "
                            "descarga de aguas grises. Consultar medidas máximas "
                            "por favor. Prohibido hacer fuego."
                        ),
                        "order": 1,
                        "product_ids": [pid("espacio-motorhome-2026")],
                    },
                    {
                        "key": "glamping",
                        "label": "Glamping",
                        "image_url": asset("gallery-2-yoga.jpg"),
                        "description": "Experiencia premium con todas las comodidades para los días del festival.",
                        "order": 2,
                        "product_ids": [pid("glamping-2026")],
                    },
                    {
                        "key": "acampe",
                        "label": "Derecho a Acampe",
                        "description": "Traé tu propia carpa. Acceso al espacio de acampe durante el festival.",
                        "order": 3,
                        "product_ids": [pid("derecho-a-acampe-2026")],
                    },
                ],
            },
            "order": 3,
            "product_category": "housing",
            "footer_note": "*No hay reembolsos, sin excepción.\n• Entradas transferibles hasta el 30 de Octubre 2026, sin excepción.\n• Entrada con DNI y QR.",
            "emoji": "tent",
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
            # Same template as Tickets/Alojamiento — no dates, multi-select.
            "template": "ticket-card",
            "template_config": {
                "variant": "stacked",
                "surface": "theme",
                "sections": [
                    {
                        "key": "auto",
                        "label": "Auto",
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
            "order": 4,
            "product_category": "parking",
            "emoji": "parking",
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
            "order": 5,
            "emoji": "film",
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
                    {"id": "g1", "url": asset("gallery-1-blue-stage.jpg")},
                    {"id": "g2", "url": asset("gallery-2-yoga.jpg")},
                    {"id": "g3", "url": asset("gallery-3-dance.jpg")},
                    {"id": "g4", "url": asset("gallery-4-dj-kevin.png")},
                    {"id": "g5", "url": asset("gallery-5-ecstatic-dance.png")},
                    {"id": "g6", "url": asset("gallery-6-deep-house-yoga.png")},
                    {"id": "g7", "url": asset("gallery-7-elias.png")},
                    {"id": "g8", "url": asset("gallery-8-yoga.png")},
                ],
            },
            "order": 6,
            "emoji": "image",
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
            "order": 7,
            "emoji": "help",
        },
        {
            "step_type": "confirm",
            "title": "Confirmar",
            "description": "Revisa tu pedido antes de pagar.",
            "watermark": "Confirmar",
            "show_title": False,
            "show_watermark": True,
            "order": 8,
            "protected": True,
            "emoji": "cart",
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
