"""
DB-to-DB migration script: Source NocoDB/PostgreSQL → EdgeOS PostgreSQL.

Migrates all data directly from the source database,
eliminating CSV-export artifacts and name-matching heuristics. All FK
relationships are preserved via explicit ID mapping.

Prerequisites:
  - Target popup and tenant must already exist in EdgeOS.
  - Source DB URL provided via SOURCE_DB_URL env var or --source-db-url.
  - Run from project root with backend on sys.path.

Usage:
    cd backend && uv run --with psycopg2-binary python scripts/migrate_from_source.py
    cd backend && uv run --with psycopg2-binary python scripts/migrate_from_source.py --popup-name "Edge Esmeralda 2026"
    cd backend && uv run --with psycopg2-binary python scripts/migrate_from_source.py --popup-id 8
    cd backend && uv run --with psycopg2-binary python scripts/migrate_from_source.py --dry-run
"""

import argparse
import os
import re
import sys
import unicodedata
import uuid as uuid_mod
from datetime import UTC, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path

import psycopg2
import psycopg2.extras
from dotenv import load_dotenv
from loguru import logger

load_dotenv()

# Ensure backend/ is on sys.path so app.* imports work
BACKEND_DIR = Path(__file__).resolve().parent.parent
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# ---------------------------------------------------------------------------
# Source DB configuration
# ---------------------------------------------------------------------------
SOURCE_DB_URL = os.environ.get("SOURCE_DB_URL", "")

# ---------------------------------------------------------------------------
# Reviewer mapping (all known reviewers across popups)
# ---------------------------------------------------------------------------

# Edge
# REVIEWER_MAP = {
#     "steph_review": {"email": "steph@edgecity.live", "full_name": "Steph"},
#     "timour_review": {"email": "timour@edgecity.live", "full_name": "Timour"},
#     "janine_review": {"email": "janine@edgecity.live", "full_name": "Janine"},
#     "tela_review": {"email": "telamon@edgecity.live", "full_name": "Telamon"},
#     "devon_review": {"email": "devon@esmeralda.org", "full_name": "Devon"},
#     "lina_review": {"email": "lina@edgecity.live", "full_name": "Lina"},
#     "katherine_review": {"email": "katherine@edgecity.live", "full_name": "Katherine"},
#     "remy_review": {"email": "remy@edgecity.live", "full_name": "Remy"},
# }

# The Mu

REVIEWER_MAP = {
    "sun_review": {"email": "sun@the-mu.xyz", "full_name": "Sun"},
    "xiaoyu_review": {"email": "xiaoyu@the-mu.xyz", "full_name": "Xiaoyu"},
    "frank_review": {"email": "frank@the-mu.xyz", "full_name": "Frank"},
}

REVIEW_VALUE_MAP = {
    "strong yes": "strong_yes",
    "yes": "yes",
    "no": "no",
    "strong no": "strong_no",
}

# Core application columns (excluded from custom field auto-detection)
CORE_APPLICATION_COLUMNS = {
    "id",
    "first_name",
    "last_name",
    "email",
    "telegram",
    "gender",
    "age",
    "residence",
    "status",
    "citizen_id",
    "popup_city_id",
    "group_id",
    "referral",
    "info_not_shared",
    "submitted_at",
    "accepted_at",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
    # Reviewer columns (handled separately)
    "steph_review",
    "timour_review",
    "janine_review",
    "tela_review",
    "devon_review",
    "lina_review",
    "katherine_review",
    "remy_review",
    "ai_review",
    # Legacy/NocoDB metadata
    "organization_id",
    "credit",
    "minting_link",
    "not_attending",
    "created_by_leader",
    "auto_approved",
    "notes",
    "send_note_to_applicant",
    "discount_assigned",
    "local_resident",
    "brings_spouse",
    "spouse_info",
    "spouse_email",
    "brings_kids",
    "kids_info",
    "payment_capacity",
    "booking_confirmation",
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = text.lower()
    text = re.sub(r"[^\w\s-]", "", text)
    text = re.sub(r"[-\s]+", "-", text)
    return text.strip("-")


def parse_bool(val) -> bool:
    if val is None:
        return False
    if isinstance(val, bool):
        return val
    return str(val).strip().lower() in ("true", "t", "1", "yes")


def parse_optional_str(val) -> str | None:
    if val is None:
        return None
    val = str(val).strip()
    return val if val else None


def parse_decimal(val) -> Decimal | None:
    if val is None:
        return None
    try:
        return Decimal(str(val).strip())
    except (InvalidOperation, ValueError):
        return None


def parse_info_not_shared(val) -> list[str]:
    if not val:
        return []
    s = str(val).strip()
    if not s:
        return []
    return [item.strip() for item in s.split(",") if item.strip()]


def build_custom_fields(row: dict, custom_field_defs: list[dict]) -> dict:
    cf = {}
    for field in custom_field_defs:
        key = field["name"]
        val = row.get(key)
        if val is None:
            continue
        val_str = str(val).strip()
        if not val_str:
            continue
        if field["is_boolean"]:
            cf[key] = parse_bool(val)
        else:
            cf[key] = val_str
    return cf


# ---------------------------------------------------------------------------
# Stats tracking
# ---------------------------------------------------------------------------
class Stats:
    def __init__(self):
        self.data: dict[str, dict[str, int]] = {}

    def init(self, entity: str):
        self.data[entity] = {"source": 0, "imported": 0, "skipped": 0, "errors": 0}

    def set_source(self, entity: str, count: int):
        self.data[entity]["source"] = count

    def inc(self, entity: str, field: str, count: int = 1):
        self.data[entity][field] += count

    def print_summary(self):
        logger.info("=" * 70)
        logger.info(
            f"{'Entity':<20} | {'Source':>7} | {'Imported':>8} | {'Skipped':>7} | {'Errors':>6}"
        )
        logger.info("-" * 70)
        for entity, counts in self.data.items():
            logger.info(
                f"{entity:<20} | {counts['source']:>7} | {counts['imported']:>8} | "
                f"{counts['skipped']:>7} | {counts['errors']:>6}"
            )
        logger.info("=" * 70)


# ---------------------------------------------------------------------------
# Source DB queries
# ---------------------------------------------------------------------------
def get_source_connection(source_url: str | None = None):
    url = source_url or SOURCE_DB_URL
    if not url:
        logger.error(
            "SOURCE_DB_URL environment variable is required (or use --source-db-url)"
        )
        sys.exit(1)
    return psycopg2.connect(url, cursor_factory=psycopg2.extras.RealDictCursor)


_logged_tables: set[str] = set()


def fetch_all(conn, query: str, params=None, label: str = "") -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(query, params)
        rows = [dict(row) for row in cur.fetchall()]
        # Log column names once per label for debugging
        if label and label not in _logged_tables and rows:
            _logged_tables.add(label)
            logger.debug(f"  [{label}] columns: {list(rows[0].keys())}")
        return rows


# ---------------------------------------------------------------------------
# Popup selection and auto-detection helpers
# ---------------------------------------------------------------------------
def select_popup(
    conn,
    popup_name: str | None = None,
    popup_id: int | None = None,
) -> tuple[int, str]:
    """Select a popup from the source DB by name, id, or interactive menu."""
    rows = fetch_all(conn, "SELECT id, name FROM popups ORDER BY id")
    if not rows:
        logger.error("No popups found in source database")
        sys.exit(1)

    # Match by ID
    if popup_id is not None:
        for row in rows:
            if row["id"] == popup_id:
                logger.info(f"Selected popup by ID: {row['name']} (id={row['id']})")
                return row["id"], row["name"]
        logger.error(f"Popup with id={popup_id} not found in source database")
        sys.exit(1)

    # Match by name (exact)
    if popup_name is not None:
        for row in rows:
            if row["name"] == popup_name:
                logger.info(f"Selected popup by name: {row['name']} (id={row['id']})")
                return row["id"], row["name"]
        logger.error(f"Popup '{popup_name}' not found in source database")
        logger.info("Available popups:")
        for row in rows:
            logger.info(f"  [{row['id']}] {row['name']}")
        sys.exit(1)

    # Interactive selection
    print("\nAvailable popups:")  # noqa: T201
    for i, row in enumerate(rows, 1):
        print(f"  {i}. [{row['id']}] {row['name']}")  # noqa: T201
    print()  # noqa: T201

    while True:
        try:
            choice = input("Select popup number: ").strip()
            idx = int(choice) - 1
            if 0 <= idx < len(rows):
                selected = rows[idx]
                logger.info(f"Selected: {selected['name']} (id={selected['id']})")
                return selected["id"], selected["name"]
            print(f"Invalid choice. Enter 1-{len(rows)}")  # noqa: T201
        except (ValueError, EOFError):
            print(f"Invalid input. Enter 1-{len(rows)}")  # noqa: T201
        except KeyboardInterrupt:
            print("\nAborted.")  # noqa: T201
            sys.exit(0)


def detect_active_reviewers(conn, popup_id: int) -> dict[str, dict]:
    """Detect which reviewers have actual review data for this popup."""
    active = {}
    for col, info in REVIEWER_MAP.items():
        rows = fetch_all(
            conn,
            f"""
            SELECT COUNT(*) as cnt FROM applications
            WHERE popup_city_id = %s
              AND {col} IS NOT NULL
              AND TRIM({col}) != ''
              AND LOWER(TRIM({col})) != 'pass'
            """,  # noqa: S608
            (popup_id,),
        )
        count = rows[0]["cnt"] if rows else 0
        if count > 0:
            active[col] = info
            logger.debug(f"  Reviewer {col}: {count} reviews")
    logger.info(f"  Active reviewers: {list(active.keys())}")
    return active


def detect_custom_fields(conn, popup_id: int) -> list[dict]:
    """Auto-detect custom field columns that have data for this popup."""
    # Get all column names and types from applications table
    col_rows = fetch_all(
        conn,
        """
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'applications'
        ORDER BY ordinal_position
        """,
    )

    # Combine all exclusions
    reviewer_columns = set(REVIEWER_MAP.keys()) | {"ai_review"}
    exclude = CORE_APPLICATION_COLUMNS | reviewer_columns

    custom_fields = []
    position = 1
    for col_row in col_rows:
        col_name = col_row["column_name"]
        col_type = col_row["data_type"]

        if col_name in exclude:
            continue

        # Check if this column has data for this popup
        rows = fetch_all(
            conn,
            f"""
            SELECT COUNT(*) as cnt FROM applications
            WHERE popup_city_id = %s
              AND {col_name} IS NOT NULL
              AND CAST({col_name} AS TEXT) != ''
            """,  # noqa: S608
            (popup_id,),
        )
        count = rows[0]["cnt"] if rows else 0
        if count == 0:
            continue

        # Infer field type from PostgreSQL data type
        is_boolean = col_type == "boolean"
        if is_boolean:
            field_type = "boolean"
        elif col_type == "text":
            field_type = "textarea"
        elif "url" in col_name.lower():
            field_type = "url"
        else:
            field_type = "text"

        # Generate label from column name
        label = col_name.replace("_", " ").title()

        custom_fields.append(
            {
                "name": col_name,
                "label": label,
                "field_type": field_type,
                "is_boolean": is_boolean,
                "position": position,
            }
        )
        position += 1
        logger.debug(f"  Custom field: {col_name} ({field_type}, {count} values)")

    logger.info(
        f"  Detected {len(custom_fields)} custom fields: "
        f"{[f['name'] for f in custom_fields]}"
    )
    return custom_fields


def sync_popup(
    source_popup_id: int,
    popup_name: str,
    source_db_url: str | None = None,
) -> None:
    """Sync popup metadata from source DB without importing any data."""
    from sqlmodel import Session, select

    from app.core.db import engine
    from app.models import Popups

    source_conn = get_source_connection(source_db_url)

    with Session(engine) as session:
        popup = session.exec(select(Popups).where(Popups.name == popup_name)).first()
        if not popup:
            logger.error(f"Popup '{popup_name}' not found in target DB.")
            sys.exit(1)

        src_popup = fetch_all(
            source_conn,
            "SELECT * FROM popups WHERE id = %s",
            (source_popup_id,),
        )
        if not src_popup:
            logger.error(f"Popup id={source_popup_id} not found in source DB.")
            sys.exit(1)

        sp = src_popup[0]
        popup.start_date = sp.get("start_date")
        popup.end_date = sp.get("end_date")
        popup.allows_spouse = parse_bool(sp.get("allows_spouse"))
        popup.allows_children = parse_bool(sp.get("allows_children"))
        popup.allows_coupons = parse_bool(sp.get("allows_coupons"))
        popup.image_url = parse_optional_str(sp.get("image_url"))
        popup.express_checkout_background = parse_optional_str(
            sp.get("express_checkout_background")
        )
        popup.web_url = parse_optional_str(sp.get("web_url"))
        popup.blog_url = parse_optional_str(sp.get("blog_url"))
        popup.twitter_url = parse_optional_str(sp.get("twitter_url"))
        popup.simplefi_api_key = parse_optional_str(sp.get("simplefi_api_key"))
        session.add(popup)
        session.commit()

    source_conn.close()
    logger.info(f"Popup '{popup_name}' synced from source successfully")


# ---------------------------------------------------------------------------
# Main import logic
# ---------------------------------------------------------------------------
def run_import(
    source_popup_id: int,
    popup_name: str,
    source_db_url: str | None = None,
    dry_run: bool = False,
) -> None:
    from sqlalchemy import delete
    from sqlmodel import Session, select

    from app.api.approval_strategy.schemas import ApprovalStrategyType
    from app.api.product.schemas import (
        ProductCategory,
        TicketAttendeeCategory,
        TicketDuration,
    )
    from app.api.shared.enums import UserRole
    from app.core.db import engine
    from app.models import (
        ApplicationReviews,
        Applications,
        ApplicationSnapshots,
        ApprovalStrategies,
        AttendeeProducts,
        Attendees,
        CheckIns,
        Coupons,
        FormFields,
        GroupLeaders,
        GroupMembers,
        Groups,
        Humans,
        PaymentProducts,
        Payments,
        PopupReviewers,
        Popups,
        Products,
        Users,
    )

    stats = Stats()
    for entity in [
        "Humans",
        "Groups",
        "GroupLeaders",
        "GroupMembers",
        "FormFields",
        "Applications",
        "Attendees",
        "ApprovalStrategy",
        "ReviewerUsers",
        "PopupReviewers",
        "Reviews",
        "Products",
        "Coupons",
        "Payments",
        "PaymentProducts",
        "AttendeeProducts",
        "CheckIns",
    ]:
        stats.init(entity)

    logger.info(f"Starting DB-to-DB migration (dry_run={dry_run})")
    logger.info(f"Source popup: {popup_name} (id={source_popup_id})")

    # ID mapping dicts
    human_map: dict[int, uuid_mod.UUID] = {}  # source citizen_id → target human.id
    group_map: dict[int, uuid_mod.UUID] = {}  # source group_id → target group.id
    app_map: dict[int, uuid_mod.UUID] = {}  # source application_id → target app.id
    attendee_map: dict[
        int, uuid_mod.UUID
    ] = {}  # source attendee_id → target attendee.id
    product_map: dict[int, uuid_mod.UUID] = {}  # source product_id → target product.id
    coupon_map: dict[
        int, uuid_mod.UUID
    ] = {}  # source coupon_code_id → target coupon.id
    payment_map: dict[int, uuid_mod.UUID] = {}  # source payment_id → target payment.id

    # Also need email→human_id for spouse humans
    email_to_human_uuid: dict[str, uuid_mod.UUID] = {}

    # ===================================================================
    # Connect to source DB and auto-detect configuration
    # ===================================================================
    logger.info("Connecting to source database...")
    source_conn = get_source_connection(source_db_url)
    logger.info("Connected to source database")

    logger.info("Detecting active reviewers...")
    active_reviewers = detect_active_reviewers(source_conn, source_popup_id)

    logger.info("Detecting custom fields...")
    custom_field_defs = detect_custom_fields(source_conn, source_popup_id)

    with Session(engine, expire_on_commit=False) as session:
        # ===============================================================
        # Step 0: Resolve popup and tenant in target
        # ===============================================================
        logger.info("Step 0: Resolving popup and tenant...")
        popup = session.exec(select(Popups).where(Popups.name == popup_name)).first()
        if not popup:
            logger.error(f"Popup '{popup_name}' not found in target DB. Aborting.")
            sys.exit(1)

        tenant_id = popup.tenant_id
        popup_id = popup.id
        logger.info(f"Found popup: {popup.name} (id={popup_id}, tenant={tenant_id})")

        # Update popup with source data
        src_popup = fetch_all(
            source_conn,
            "SELECT * FROM popups WHERE id = %s",
            (source_popup_id,),
            label="source_popup",
        )
        if src_popup:
            sp = src_popup[0]
            popup.start_date = sp.get("start_date")
            popup.end_date = sp.get("end_date")
            popup.allows_spouse = parse_bool(sp.get("allows_spouse"))
            popup.allows_children = parse_bool(sp.get("allows_children"))
            popup.allows_coupons = parse_bool(sp.get("allows_coupons"))
            popup.image_url = parse_optional_str(sp.get("image_url"))
            popup.express_checkout_background = parse_optional_str(
                sp.get("express_checkout_background")
            )
            popup.web_url = parse_optional_str(sp.get("web_url"))
            popup.blog_url = parse_optional_str(sp.get("blog_url"))
            popup.twitter_url = parse_optional_str(sp.get("twitter_url"))
            popup.simplefi_api_key = parse_optional_str(sp.get("simplefi_api_key"))
            session.add(popup)
            logger.info("  Updated popup with source data")

        # ===============================================================
        # Step 1: Cleanup existing data (idempotent re-runs)
        # ===============================================================
        logger.info("Step 1: Cleaning up previous import data...")

        app_ids_subq = select(Applications.id).where(Applications.popup_id == popup_id)
        attendee_ids_subq = select(Attendees.id).where(
            Attendees.application_id.in_(app_ids_subq)  # type: ignore[attr-defined]
        )
        payment_ids_subq = select(Payments.id).where(
            Payments.application_id.in_(app_ids_subq)  # type: ignore[attr-defined]
        )

        # Delete in reverse FK order
        cleanup_ops = [
            (
                "check_ins",
                delete(CheckIns).where(
                    CheckIns.attendee_id.in_(attendee_ids_subq)  # type: ignore[attr-defined]
                ),
            ),
            (
                "attendee_products",
                delete(AttendeeProducts).where(
                    AttendeeProducts.attendee_id.in_(attendee_ids_subq)  # type: ignore[attr-defined]
                ),
            ),
            (
                "payment_products",
                delete(PaymentProducts).where(
                    PaymentProducts.payment_id.in_(payment_ids_subq)  # type: ignore[attr-defined]
                ),
            ),
            (
                "payments",
                delete(Payments).where(
                    Payments.application_id.in_(app_ids_subq)  # type: ignore[attr-defined]
                ),
            ),
            ("coupons", delete(Coupons).where(Coupons.popup_id == popup_id)),
            ("products", delete(Products).where(Products.popup_id == popup_id)),
            (
                "application_reviews",
                delete(ApplicationReviews).where(
                    ApplicationReviews.application_id.in_(app_ids_subq)  # type: ignore[attr-defined]
                ),
            ),
            (
                "popup_reviewers",
                delete(PopupReviewers).where(PopupReviewers.popup_id == popup_id),
            ),
            (
                "approval_strategies",
                delete(ApprovalStrategies).where(
                    ApprovalStrategies.popup_id == popup_id
                ),
            ),
            (
                "snapshots",
                delete(ApplicationSnapshots).where(
                    ApplicationSnapshots.application_id.in_(app_ids_subq)  # type: ignore[attr-defined]
                ),
            ),
            (
                "attendees",
                delete(Attendees).where(
                    Attendees.application_id.in_(app_ids_subq)  # type: ignore[attr-defined]
                ),
            ),
            (
                "applications",
                delete(Applications).where(Applications.popup_id == popup_id),
            ),
            (
                "group_leaders",
                delete(GroupLeaders).where(
                    GroupLeaders.group_id.in_(  # type: ignore[attr-defined]
                        select(Groups.id).where(Groups.popup_id == popup_id)
                    )
                ),
            ),
            (
                "group_members",
                delete(GroupMembers).where(
                    GroupMembers.group_id.in_(  # type: ignore[attr-defined]
                        select(Groups.id).where(Groups.popup_id == popup_id)
                    )
                ),
            ),
            ("groups", delete(Groups).where(Groups.popup_id == popup_id)),
        ]

        for name, stmt in cleanup_ops:
            result = session.exec(stmt)  # type: ignore[call-overload]
            logger.info(f"  Deleted {result.rowcount} {name}")  # type: ignore[union-attr]

        logger.info("Cleanup complete")

        # ===============================================================
        # Step 2: Import Humans (upsert — humans are cross-popup)
        # ===============================================================
        logger.info("Step 2: Importing humans...")

        # Load existing humans for this tenant to avoid duplicates
        existing_humans = session.exec(
            select(Humans).where(Humans.tenant_id == tenant_id)
        ).all()
        existing_humans_by_email: dict[str, Humans] = {
            h.email: h for h in existing_humans
        }
        logger.info(f"  Existing humans in tenant: {len(existing_humans_by_email)}")

        # Main humans: those who have applications for this popup
        src_humans = fetch_all(
            source_conn,
            """
            SELECT DISTINCT h.*
            FROM humans h
            JOIN applications a ON h.id = a.citizen_id
            WHERE a.popup_city_id = %s
        """,
            (source_popup_id,),
            label="humans",
        )
        stats.set_source("Humans", len(src_humans))
        logger.info(f"  Source humans (applicants): {len(src_humans)}")

        # Also get spouse attendees with emails (create Human records for them)
        src_spouse_attendees = fetch_all(
            source_conn,
            """
            SELECT DISTINCT att.email, att.name, att.gender
            FROM attendees att
            JOIN applications a ON att.application_id = a.id
            WHERE a.popup_city_id = %s
              AND att.category IN ('spouse', 'baby', 'teen')
              AND att.email IS NOT NULL
              AND att.email != ''
        """,
            (source_popup_id,),
        )

        new_humans: list[Humans] = []
        for row in src_humans:
            email = (row.get("primary_email") or row.get("email") or "").strip().lower()
            if not email:
                stats.inc("Humans", "skipped")
                continue

            existing = existing_humans_by_email.get(email)
            if existing:
                # Reuse existing human
                human_map[row["id"]] = existing.id
                email_to_human_uuid[email] = existing.id
                stats.inc("Humans", "skipped")
            else:
                human = Humans(
                    tenant_id=tenant_id,
                    email=email,
                    first_name=parse_optional_str(row.get("first_name")),
                    last_name=parse_optional_str(row.get("last_name")),
                    telegram=parse_optional_str(row.get("telegram")),
                    gender=parse_optional_str(row.get("gender")),
                    age=parse_optional_str(row.get("age")),
                    residence=parse_optional_str(row.get("residence")),
                )
                new_humans.append(human)
                human_map[row["id"]] = human.id
                email_to_human_uuid[email] = human.id
                existing_humans_by_email[email] = human
                stats.inc("Humans", "imported")

        # Create Human records for spouse attendees with emails not already covered
        spouse_humans_created = 0
        for row in src_spouse_attendees:
            email = (row.get("email") or "").strip().lower()
            if not email or email in email_to_human_uuid:
                continue

            name = parse_optional_str(row.get("name")) or ""
            parts = name.split(None, 1)
            first_name = parts[0] if parts else None
            last_name = parts[1] if len(parts) > 1 else None

            human = Humans(
                tenant_id=tenant_id,
                email=email,
                first_name=first_name,
                last_name=last_name,
                gender=parse_optional_str(row.get("gender")),
            )
            new_humans.append(human)
            email_to_human_uuid[email] = human.id
            existing_humans_by_email[email] = human
            spouse_humans_created += 1
            stats.inc("Humans", "imported")

        stats.set_source(
            "Humans", stats.data["Humans"]["source"] + spouse_humans_created
        )

        if new_humans:
            session.add_all(new_humans)
            session.flush()

        logger.info(
            f"  Humans: {stats.data['Humans']['imported']} created, "
            f"{stats.data['Humans']['skipped']} existing, "
            f"{spouse_humans_created} spouse"
        )

        # ===============================================================
        # Step 3: Import Groups
        # ===============================================================
        logger.info("Step 3: Importing groups...")

        src_groups = fetch_all(
            source_conn,
            """
            SELECT DISTINCT g.*
            FROM groups g
            WHERE g.popup_city_id = %s
              AND (
                EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = g.id)
                OR EXISTS (SELECT 1 FROM group_leaders gl WHERE gl.group_id = g.id)
                OR EXISTS (SELECT 1 FROM applications a WHERE a.group_id = g.id AND a.popup_city_id = %s)
                OR EXISTS (SELECT 1 FROM payments p WHERE p.group_id = g.id
                           AND p.application_id IN (SELECT id FROM applications WHERE popup_city_id = %s))
              )
        """,
            (source_popup_id, source_popup_id, source_popup_id),
            label="groups",
        )
        stats.set_source("Groups", len(src_groups))
        logger.info(f"  Source groups: {len(src_groups)}")

        new_groups: list[Groups] = []
        seen_slugs: set[str] = set()

        for row in src_groups:
            name = row.get("name") or f"Group {row['id']}"
            base_slug = slugify(name)
            slug = base_slug
            counter = 1
            while slug in seen_slugs:
                slug = f"{base_slug}-{counter}"
                counter += 1
            seen_slugs.add(slug)

            # Resolve ambassador (source may use ambassador_id or ambassador_citizen_id)
            ambassador_id = None
            src_ambassador = row.get("ambassador_id") or row.get(
                "ambassador_citizen_id"
            )
            if src_ambassador and src_ambassador in human_map:
                ambassador_id = human_map[src_ambassador]

            group = Groups(
                tenant_id=tenant_id,
                popup_id=popup_id,
                name=name,
                slug=slug,
                description=parse_optional_str(row.get("description")),
                discount_percentage=Decimal(str(row.get("discount_percentage") or 0)),
                max_members=row.get("max_members"),
                welcome_message=parse_optional_str(row.get("welcome_message")),
                is_ambassador_group=parse_bool(row.get("is_ambassador_group")),
                ambassador_id=ambassador_id,
            )
            new_groups.append(group)
            group_map[row["id"]] = group.id
            stats.inc("Groups", "imported")

        if new_groups:
            session.add_all(new_groups)
            session.flush()

        logger.info(f"  Groups: {stats.data['Groups']['imported']} imported")

        # Import group_leaders
        logger.info("  Importing group leaders...")
        src_leaders = fetch_all(
            source_conn,
            """
            SELECT gl.*
            FROM group_leaders gl
            JOIN groups g ON gl.group_id = g.id
            WHERE g.popup_city_id = %s
        """,
            (source_popup_id,),
            label="group_leaders",
        )
        stats.set_source("GroupLeaders", len(src_leaders))

        new_leaders: list[GroupLeaders] = []
        for row in src_leaders:
            gid = group_map.get(row["group_id"])
            hid = human_map.get(row.get("human_id") or row.get("citizen_id"))
            if not gid or not hid:
                stats.inc("GroupLeaders", "skipped")
                continue
            new_leaders.append(
                GroupLeaders(
                    tenant_id=tenant_id,
                    group_id=gid,
                    human_id=hid,
                )
            )
            stats.inc("GroupLeaders", "imported")

        if new_leaders:
            session.add_all(new_leaders)

        # Import group_members
        logger.info("  Importing group members...")
        src_members = fetch_all(
            source_conn,
            """
            SELECT gm.*
            FROM group_members gm
            JOIN groups g ON gm.group_id = g.id
            WHERE g.popup_city_id = %s
        """,
            (source_popup_id,),
            label="group_members",
        )
        stats.set_source("GroupMembers", len(src_members))

        new_members: list[GroupMembers] = []
        seen_member_keys: set[tuple] = set()
        for row in src_members:
            gid = group_map.get(row["group_id"])
            hid = human_map.get(row.get("human_id") or row.get("citizen_id"))
            if not gid or not hid:
                stats.inc("GroupMembers", "skipped")
                continue
            key = (gid, hid)
            if key in seen_member_keys:
                stats.inc("GroupMembers", "skipped")
                continue
            seen_member_keys.add(key)
            new_members.append(
                GroupMembers(
                    tenant_id=tenant_id,
                    group_id=gid,
                    human_id=hid,
                )
            )
            stats.inc("GroupMembers", "imported")

        if new_members:
            session.add_all(new_members)

        logger.info(
            f"  GroupLeaders: {stats.data['GroupLeaders']['imported']} imported, "
            f"GroupMembers: {stats.data['GroupMembers']['imported']} imported"
        )

        # ===============================================================
        # Step 4: Import FormFields (auto-generated from detected fields)
        # ===============================================================
        logger.info("Step 4: Importing form fields...")

        existing_ffs = session.exec(
            select(FormFields).where(FormFields.popup_id == popup_id)
        ).all()
        existing_ff_names: set[str] = {ff.name for ff in existing_ffs}

        new_ffs: list[FormFields] = []
        for fdef in custom_field_defs:
            if fdef["name"] in existing_ff_names:
                stats.inc("FormFields", "skipped")
                continue
            ff = FormFields(
                tenant_id=tenant_id,
                popup_id=popup_id,
                name=fdef["name"],
                label=fdef["label"],
                field_type=fdef["field_type"],
                section_id=None,
                position=fdef.get("position", 0),
                required=False,
            )
            new_ffs.append(ff)
            stats.inc("FormFields", "imported")

        stats.set_source("FormFields", len(custom_field_defs))

        if new_ffs:
            session.add_all(new_ffs)
        logger.info(f"  FormFields: {stats.data['FormFields']['imported']} imported")

        # ===============================================================
        # Step 5: Import Applications
        # ===============================================================
        logger.info("Step 5: Importing applications...")

        src_apps = fetch_all(
            source_conn,
            """
            SELECT * FROM applications WHERE popup_city_id = %s
        """,
            (source_popup_id,),
        )
        stats.set_source("Applications", len(src_apps))
        logger.info(f"  Source applications: {len(src_apps)}")

        new_apps: list[Applications] = []
        for row in src_apps:
            human_uuid = human_map.get(row["citizen_id"])
            if not human_uuid:
                logger.warning(
                    f"  No human for citizen_id={row['citizen_id']}, skipping app {row['id']}"
                )
                stats.inc("Applications", "errors")
                continue

            group_uuid = group_map.get(row["group_id"]) if row.get("group_id") else None

            status = parse_optional_str(row.get("status")) or "draft"
            referral = parse_optional_str(row.get("referral"))
            if referral and len(referral) > 255:
                referral = referral[:255]

            info_not_shared = parse_info_not_shared(row.get("info_not_shared"))
            custom_fields = build_custom_fields(row, custom_field_defs)

            # Preserve AI review text as a custom field
            ai_review_text = parse_optional_str(row.get("ai_review"))
            if ai_review_text:
                custom_fields["ai_review"] = ai_review_text

            submitted_at = row.get("submitted_at")
            accepted_at = row.get("accepted_at")
            created_at = row.get("created_at")
            updated_at = row.get("updated_at")

            app = Applications(
                tenant_id=tenant_id,
                popup_id=popup_id,
                human_id=human_uuid,
                group_id=group_uuid,
                status=status,
                referral=referral,
                info_not_shared=info_not_shared,
                custom_fields=custom_fields,
                submitted_at=submitted_at,
                accepted_at=accepted_at,
                created_at=created_at or datetime.now(UTC),
                updated_at=updated_at or datetime.now(UTC),
            )
            new_apps.append(app)
            app_map[row["id"]] = app.id
            stats.inc("Applications", "imported")

        if new_apps:
            session.add_all(new_apps)
            session.flush()

        logger.info(
            f"  Applications: {stats.data['Applications']['imported']} imported"
        )

        # ===============================================================
        # Step 6: Import Attendees
        # ===============================================================
        logger.info("Step 6: Importing attendees...")

        src_attendees = fetch_all(
            source_conn,
            """
            SELECT att.*
            FROM attendees att
            JOIN applications a ON att.application_id = a.id
            WHERE a.popup_city_id = %s
        """,
            (source_popup_id,),
        )
        stats.set_source("Attendees", len(src_attendees))
        logger.info(f"  Source attendees: {len(src_attendees)}")

        new_attendees: list[Attendees] = []
        for row in src_attendees:
            application_uuid = app_map.get(row["application_id"])
            if not application_uuid:
                logger.warning(
                    f"  No app mapping for attendee {row['id']} (app_id={row['application_id']})"
                )
                stats.inc("Attendees", "errors")
                continue

            # Map category: baby/teen → kid
            category = (row.get("category") or "main").strip().lower()
            if category in ("baby", "teen"):
                category = "kid"

            # Resolve human_id by email
            att_email = parse_optional_str(row.get("email"))
            att_email_clean = att_email.strip().lower() if att_email else None
            human_uuid = (
                email_to_human_uuid.get(att_email_clean) if att_email_clean else None
            )

            check_in_code = parse_optional_str(row.get("check_in_code")) or ""

            attendee = Attendees(
                tenant_id=tenant_id,
                application_id=application_uuid,
                human_id=human_uuid,
                name=parse_optional_str(row.get("name")) or "Unknown",
                category=category,
                email=att_email_clean,
                gender=parse_optional_str(row.get("gender")),
                check_in_code=check_in_code,
                poap_url=parse_optional_str(row.get("poap_url")),
            )
            new_attendees.append(attendee)
            attendee_map[row["id"]] = attendee.id
            stats.inc("Attendees", "imported")

        if new_attendees:
            session.add_all(new_attendees)
            session.flush()

        logger.info(f"  Attendees: {stats.data['Attendees']['imported']} imported")

        # ===============================================================
        # Step 7: Approval Strategy + Reviewers + Reviews
        # ===============================================================
        logger.info("Step 7: Creating approval strategy and reviewers...")

        # Approval strategy (check if one already exists for this popup)
        existing_strategy = session.exec(
            select(ApprovalStrategies).where(ApprovalStrategies.popup_id == popup_id)
        ).first()
        if existing_strategy:
            strategy = existing_strategy
            logger.info("  Approval strategy already exists, reusing")
        else:
            strategy = ApprovalStrategies(
                popup_id=popup_id,
                tenant_id=tenant_id,
                strategy_type=ApprovalStrategyType.WEIGHTED,
            )
            session.add(strategy)
        stats.set_source("ApprovalStrategy", 1)
        stats.inc("ApprovalStrategy", "imported")

        # Reviewer users (only for active reviewers)
        existing_users = session.exec(
            select(Users).where(Users.tenant_id == tenant_id)
        ).all()
        existing_users_by_email: dict[str, Users] = {u.email: u for u in existing_users}

        reviewer_user_map: dict[str, Users] = {}
        new_reviewer_users: list[Users] = []
        stats.set_source("ReviewerUsers", len(active_reviewers))

        for col, info in active_reviewers.items():
            existing_user = existing_users_by_email.get(info["email"])
            if existing_user:
                reviewer_user_map[col] = existing_user
                stats.inc("ReviewerUsers", "skipped")
            else:
                user = Users(
                    email=info["email"],
                    full_name=info["full_name"],
                    role=UserRole.ADMIN,
                    tenant_id=tenant_id,
                )
                new_reviewer_users.append(user)
                reviewer_user_map[col] = user
                stats.inc("ReviewerUsers", "imported")

        if new_reviewer_users:
            session.add_all(new_reviewer_users)
            session.flush()

        # Popup reviewers (skip existing)
        existing_popup_reviewers = session.exec(
            select(PopupReviewers).where(PopupReviewers.popup_id == popup_id)
        ).all()
        existing_pr_user_ids: set[str] = {
            str(pr.user_id) for pr in existing_popup_reviewers
        }

        stats.set_source("PopupReviewers", len(active_reviewers))
        new_popup_reviewers: list[PopupReviewers] = []
        for user in reviewer_user_map.values():
            if str(user.id) in existing_pr_user_ids:
                stats.inc("PopupReviewers", "skipped")
                continue
            pr = PopupReviewers(
                popup_id=popup_id,
                user_id=user.id,
                tenant_id=tenant_id,
                weight_multiplier=1.0,
                is_required=False,
            )
            new_popup_reviewers.append(pr)
            stats.inc("PopupReviewers", "imported")

        if new_popup_reviewers:
            session.add_all(new_popup_reviewers)

        # Application reviews from source (only active reviewer columns)
        logger.info("  Importing application reviews...")
        if active_reviewers:
            review_cols = ", ".join(active_reviewers.keys())
            src_review_apps = fetch_all(
                source_conn,
                f"""
                SELECT id, {review_cols}
                FROM applications
                WHERE popup_city_id = %s
            """,  # noqa: S608
                (source_popup_id,),
            )
        else:
            src_review_apps = []

        new_reviews: list[ApplicationReviews] = []
        stats.set_source("Reviews", 0)  # will count as we go

        for row in src_review_apps:
            target_app_id = app_map.get(row["id"])
            if not target_app_id:
                continue

            for col in active_reviewers:
                raw_value = parse_optional_str(row.get(col))
                if not raw_value:
                    continue
                raw_value = raw_value.lower()
                if raw_value == "pass":
                    continue

                stats.set_source("Reviews", stats.data["Reviews"]["source"] + 1)
                decision_str = REVIEW_VALUE_MAP.get(raw_value)
                if not decision_str:
                    logger.warning(
                        f"  Unknown review value '{raw_value}' for app {row['id']}"
                    )
                    stats.inc("Reviews", "errors")
                    continue

                reviewer_user = reviewer_user_map.get(col)
                if not reviewer_user:
                    stats.inc("Reviews", "errors")
                    continue

                review = ApplicationReviews(
                    application_id=target_app_id,
                    reviewer_id=reviewer_user.id,
                    tenant_id=tenant_id,
                    decision=decision_str,
                )
                new_reviews.append(review)
                stats.inc("Reviews", "imported")

        if new_reviews:
            session.add_all(new_reviews)
        logger.info(f"  Reviews: {stats.data['Reviews']['imported']} imported")

        # ===============================================================
        # Step 8: Import Products
        # ===============================================================
        logger.info("Step 8: Importing products...")

        src_products = fetch_all(
            source_conn,
            """
            SELECT * FROM products WHERE popup_city_id = %s
        """,
            (source_popup_id,),
        )
        stats.set_source("Products", len(src_products))
        logger.info(f"  Source products: {len(src_products)}")

        # PG native enums use uppercase names (TICKET, DAY, MAIN, etc.)
        # SQLAlchemy sends enum .name by default, so use enum members directly
        duration_map = {
            "day": TicketDuration.DAY,
            "local day": TicketDuration.DAY,
            "week": TicketDuration.WEEK,
            "local week": TicketDuration.WEEK,
            "month": TicketDuration.MONTH,
            "local month": TicketDuration.MONTH,
            "full": TicketDuration.FULL,
        }
        attendee_cat_map = {
            "main": TicketAttendeeCategory.MAIN,
            "spouse": TicketAttendeeCategory.SPOUSE,
            "kid": TicketAttendeeCategory.KID,
        }

        new_products: list[Products] = []
        product_seen_slugs: set[str] = set()

        for row in src_products:
            name = (
                row.get("name") or row.get("Name") or f"Product {row['id']}"
            ).strip()
            price = Decimal(str(row.get("price") or row.get("Price") or 0))

            # Category: patreon stays patreon, everything else → ticket
            src_category = (row.get("category") or "ticket").strip().lower()
            if src_category == "patreon":
                category = ProductCategory.PATREON
            else:
                category = ProductCategory.TICKET

            # Duration type from source category
            duration_type = (
                duration_map.get(src_category)
                if category == ProductCategory.TICKET
                else None
            )

            # Attendee category
            att_cat_str = parse_optional_str(row.get("attendee_category"))
            attendee_category = (
                attendee_cat_map.get(att_cat_str.lower()) if att_cat_str else None
            )

            # Generate unique slug
            base_slug = slugify(name)
            slug = f"{base_slug}-{att_cat_str.lower()}" if att_cat_str else base_slug
            counter = 1
            original_slug = slug
            while slug in product_seen_slugs:
                slug = f"{original_slug}-{counter}"
                counter += 1
            product_seen_slugs.add(slug)

            start_date = row.get("start_date")
            end_date = row.get("end_date")
            is_active = (
                parse_bool(row.get("is_active"))
                if row.get("is_active") is not None
                else True
            )
            exclusive = parse_bool(row.get("exclusive"))
            max_quantity = row.get("max_quantity")

            product = Products(
                tenant_id=tenant_id,
                popup_id=popup_id,
                name=name,
                slug=slug,
                price=price,
                description=parse_optional_str(row.get("description")),
                category=category,
                attendee_category=attendee_category,
                duration_type=duration_type,
                start_date=start_date,
                end_date=end_date,
                is_active=is_active,
                exclusive=exclusive,
                max_quantity=max_quantity,
            )
            new_products.append(product)
            product_map[row["id"]] = product.id
            stats.inc("Products", "imported")

        if new_products:
            session.add_all(new_products)
            session.flush()

        logger.info(f"  Products: {stats.data['Products']['imported']} imported")

        # ===============================================================
        # Step 9: Import Coupons
        # ===============================================================
        logger.info("Step 9: Importing coupons...")

        src_coupons = fetch_all(
            source_conn,
            """
            SELECT * FROM coupon_codes WHERE popup_city_id = %s
        """,
            (source_popup_id,),
        )
        stats.set_source("Coupons", len(src_coupons))
        logger.info(f"  Source coupons: {len(src_coupons)}")

        new_coupons: list[Coupons] = []
        for row in src_coupons:
            code = (row.get("code") or "").strip().upper()
            if not code:
                stats.inc("Coupons", "skipped")
                continue

            # Discount value: round to nearest 10 for EdgeOS constraint
            raw_discount = (
                row.get("discount_value") or row.get("discount_percentage") or 0
            )
            try:
                discount_int = int(float(str(raw_discount)))
            except (ValueError, TypeError):
                discount_int = 0
            # Round to nearest valid value (multiples of 10, 0-100)
            discount_int = max(0, min(100, round(discount_int / 10) * 10))

            coupon = Coupons(
                tenant_id=tenant_id,
                popup_id=popup_id,
                code=code,
                discount_value=discount_int,
                max_uses=row.get("max_uses"),
                current_uses=row.get("current_uses") or 0,
                start_date=row.get("start_date"),
                end_date=row.get("end_date"),
                is_active=parse_bool(row.get("is_active"))
                if row.get("is_active") is not None
                else True,
            )
            new_coupons.append(coupon)
            coupon_map[row["id"]] = coupon.id
            stats.inc("Coupons", "imported")

        if new_coupons:
            session.add_all(new_coupons)
            session.flush()

        logger.info(f"  Coupons: {stats.data['Coupons']['imported']} imported")

        # ===============================================================
        # Step 10: Import Payments
        # ===============================================================
        logger.info("Step 10: Importing payments...")

        src_payments = fetch_all(
            source_conn,
            """
            SELECT p.*
            FROM payments p
            JOIN applications a ON p.application_id = a.id
            WHERE a.popup_city_id = %s
        """,
            (source_popup_id,),
        )
        stats.set_source("Payments", len(src_payments))
        logger.info(f"  Source payments: {len(src_payments)}")

        new_payments: list[Payments] = []
        for row in src_payments:
            application_uuid = app_map.get(row["application_id"])
            if not application_uuid:
                logger.warning(f"  No app mapping for payment {row['id']}")
                stats.inc("Payments", "errors")
                continue

            coupon_uuid = (
                coupon_map.get(row["coupon_code_id"])
                if row.get("coupon_code_id")
                else None
            )
            group_uuid = group_map.get(row["group_id"]) if row.get("group_id") else None

            amount = Decimal(str(row.get("amount") or 0))
            rate = parse_decimal(row.get("rate"))
            discount_value = parse_decimal(row.get("discount_value"))

            payment = Payments(
                tenant_id=tenant_id,
                application_id=application_uuid,
                coupon_id=coupon_uuid,
                group_id=group_uuid,
                external_id=parse_optional_str(row.get("external_id")),
                status=parse_optional_str(row.get("status")) or "pending",
                amount=amount,
                currency=parse_optional_str(row.get("currency")) or "USD",
                rate=rate,
                source=parse_optional_str(row.get("source")),
                checkout_url=parse_optional_str(row.get("checkout_url")),
                coupon_code=parse_optional_str(row.get("coupon_code")),
                discount_value=discount_value,
                edit_passes=parse_bool(row.get("edit_passes")),
                created_at=row.get("created_at") or datetime.now(UTC),
                updated_at=row.get("updated_at") or datetime.now(UTC),
            )
            new_payments.append(payment)
            payment_map[row["id"]] = payment.id
            stats.inc("Payments", "imported")

        if new_payments:
            session.add_all(new_payments)
            session.flush()

        logger.info(f"  Payments: {stats.data['Payments']['imported']} imported")

        # ===============================================================
        # Step 11: Import PaymentProducts + AttendeeProducts
        # ===============================================================
        logger.info("Step 11: Importing payment products...")

        src_pp = fetch_all(
            source_conn,
            """
            SELECT pp.*
            FROM payment_products pp
            JOIN payments p ON pp.payment_id = p.id
            JOIN applications a ON p.application_id = a.id
            WHERE a.popup_city_id = %s
        """,
            (source_popup_id,),
        )
        stats.set_source("PaymentProducts", len(src_pp))
        logger.info(f"  Source payment_products: {len(src_pp)}")

        # Build product info lookup for snapshots
        product_info: dict[uuid_mod.UUID, Products] = {p.id: p for p in new_products}

        # Dedup structures
        seen_pp: dict[tuple, PaymentProducts] = {}
        seen_ap: dict[tuple, AttendeeProducts] = {}
        new_payment_products: list[PaymentProducts] = []
        new_attendee_products: list[AttendeeProducts] = []

        # Also need to know which payments are approved for AttendeeProducts
        approved_payment_ids: set[uuid_mod.UUID] = set()
        for row in src_payments:
            if (row.get("status") or "").lower() == "approved":
                pid = payment_map.get(row["id"])
                if pid:
                    approved_payment_ids.add(pid)

        for row in src_pp:
            pay_uuid = payment_map.get(row["payment_id"])
            prod_uuid = product_map.get(row["product_id"])
            att_uuid = attendee_map.get(row["attendee_id"])  # DIRECT FK!

            if not pay_uuid or not prod_uuid or not att_uuid:
                missing = []
                if not pay_uuid:
                    missing.append(f"payment_id={row['payment_id']}")
                if not prod_uuid:
                    missing.append(f"product_id={row['product_id']}")
                if not att_uuid:
                    missing.append(f"attendee_id={row['attendee_id']}")
                logger.warning(
                    f"  Missing mapping for pp {row.get('id', '?')}: {', '.join(missing)}"
                )
                stats.inc("PaymentProducts", "errors")
                continue

            quantity = int(row.get("quantity") or 1)
            product = product_info.get(prod_uuid)

            # Dedup PaymentProducts by composite PK
            pp_key = (str(pay_uuid), str(prod_uuid), str(att_uuid))
            existing_pp = seen_pp.get(pp_key)
            if existing_pp:
                existing_pp.quantity += quantity
                stats.inc("PaymentProducts", "skipped")
            else:
                pp = PaymentProducts(
                    tenant_id=tenant_id,
                    payment_id=pay_uuid,
                    product_id=prod_uuid,
                    attendee_id=att_uuid,
                    quantity=quantity,
                    product_name=product.name if product else "Unknown",
                    product_description=product.description if product else None,
                    product_price=product.price if product else Decimal("0"),
                    product_category=product.category.value
                    if product and hasattr(product.category, "value")
                    else "ticket",
                )
                new_payment_products.append(pp)
                seen_pp[pp_key] = pp
                stats.inc("PaymentProducts", "imported")

            # Build AttendeeProducts only from approved payments
            if pay_uuid in approved_payment_ids:
                ap_key = (str(att_uuid), str(prod_uuid))
                existing_ap = seen_ap.get(ap_key)
                if existing_ap:
                    existing_ap.quantity += quantity
                else:
                    ap = AttendeeProducts(
                        tenant_id=tenant_id,
                        attendee_id=att_uuid,
                        product_id=prod_uuid,
                        quantity=quantity,
                    )
                    new_attendee_products.append(ap)
                    seen_ap[ap_key] = ap
                    stats.inc("AttendeeProducts", "imported")

        stats.set_source("AttendeeProducts", len(src_pp))  # approximation

        session.add_all(new_payment_products)
        session.add_all(new_attendee_products)

        logger.info(
            f"  PaymentProducts: {stats.data['PaymentProducts']['imported']} imported, "
            f"AttendeeProducts: {stats.data['AttendeeProducts']['imported']} imported"
        )

        # ===============================================================
        # Step 12: Import CheckIns
        # ===============================================================
        logger.info("Step 12: Importing check-ins...")

        src_checkins = fetch_all(
            source_conn,
            """
            SELECT ci.*
            FROM check_ins ci
            JOIN attendees att ON ci.attendee_id = att.id
            JOIN applications a ON att.application_id = a.id
            WHERE a.popup_city_id = %s
        """,
            (source_popup_id,),
        )
        stats.set_source("CheckIns", len(src_checkins))
        logger.info(f"  Source check_ins: {len(src_checkins)}")

        new_checkins: list[CheckIns] = []
        for row in src_checkins:
            att_uuid = attendee_map.get(row["attendee_id"])
            if not att_uuid:
                logger.warning(
                    f"  No attendee mapping for check_in {row.get('id', '?')}"
                )
                stats.inc("CheckIns", "errors")
                continue

            checkin = CheckIns(
                tenant_id=tenant_id,
                attendee_id=att_uuid,
                arrival_date=row.get("arrival_date"),
                departure_date=row.get("departure_date"),
                qr_check_in=parse_bool(row.get("qr_check_in")),
                qr_scan_timestamp=row.get("qr_scan_timestamp"),
            )
            new_checkins.append(checkin)
            stats.inc("CheckIns", "imported")

        if new_checkins:
            session.add_all(new_checkins)

        logger.info(f"  CheckIns: {stats.data['CheckIns']['imported']} imported")

        # ===============================================================
        # Final: commit or rollback the entire transaction
        # ===============================================================
        if dry_run:
            session.rollback()
            logger.info("Transaction rolled back (dry run)")
        else:
            session.commit()
            logger.info("Transaction committed successfully")

    # ===================================================================
    # Close source connection and print summary
    # ===================================================================
    source_conn.close()

    logger.info("")
    stats.print_summary()

    if dry_run:
        logger.info("** DRY RUN — no data was written to target DB **")

    logger.info("Migration complete!")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description="DB-to-DB migration from source NocoDB/PostgreSQL to EdgeOS"
    )
    parser.add_argument(
        "--popup-name",
        help="Source popup name (exact match)",
    )
    parser.add_argument(
        "--popup-id",
        type=int,
        help="Source popup ID",
    )
    parser.add_argument(
        "--source-db-url",
        help="Override SOURCE_DB_URL env var",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Read source and report counts without writing to target",
    )
    parser.add_argument(
        "--sync-popup-only",
        action="store_true",
        help="Only sync popup metadata from source, skip data import",
    )
    args = parser.parse_args()

    # Connect to source, select popup
    source_url = args.source_db_url or SOURCE_DB_URL
    conn = get_source_connection(source_url)
    selected_popup_id, selected_popup_name = select_popup(
        conn, args.popup_name, args.popup_id
    )
    conn.close()

    if args.sync_popup_only:
        sync_popup(
            source_popup_id=selected_popup_id,
            popup_name=selected_popup_name,
            source_db_url=args.source_db_url,
        )
    else:
        run_import(
            source_popup_id=selected_popup_id,
            popup_name=selected_popup_name,
            source_db_url=args.source_db_url,
            dry_run=args.dry_run,
        )
