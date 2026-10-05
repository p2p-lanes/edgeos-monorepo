"""Isolated local RSVP fixtures and server. Never reads production credentials.

Run from the repo root with .venv/bin/python backend/scripts/rsvp_validation.py
{migrate,seed,serve,browser,validate}. Requires the dedicated localhost:25432 database.
The browser command authenticates synthetic accounts without sending emails or
printing/writing access tokens. It opens a separate agent-browser session.
"""

import argparse
import json
import os
import subprocess
import sys
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from urllib.parse import urlencode

BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND))
# Supply required settings before importing config, then disable env-file reads.
os.environ.update(
    SECRET_KEY="rsvp-local-validation-key-not-for-production",
    PROJECT_NAME="RSVP local validation",
    ENVIRONMENT="dev",
    POSTGRES_SERVER="127.0.0.1",
    POSTGRES_PORT="25432",
    POSTGRES_USER="rsvp_local",
    POSTGRES_PASSWORD="rsvp-local-only",
    POSTGRES_DB="edgeos_rsvp_validation",
    POSTGRES_SSL_MODE="disable",
    SUPERADMIN="admin.rsvp@example.com",
)
from app.core import config  # noqa: E402

config.settings = config.Settings(
    _env_file=None,
    SMTP_HOST=None,
    SMTP_USER=None,
    SMTP_PASSWORD=None,
    SENDER_EMAIL=None,
    SENTRY_DSN=None,
    STORAGE_ACCESS_KEY="",
    STORAGE_SECRET_KEY="",
    STORAGE_ENDPOINT_URL=None,
    REDIS_URL=None,
    GEMINI_API_KEY=None,
    GOOGLE_FONTS_API_KEY=None,
    BACKEND_URL="http://localhost:8000",
    BACKOFFICE_URL="http://localhost:5173",
    PORTAL_URL="http://localhost:3000",
    PENDING_SWEEP_ENABLED=False,
    SUPERSEDE_PENDING_ENABLED=False,
)

from sqlmodel import Session  # noqa: E402

import app.models  # noqa: E402, F401
from app.core.db import engine  # noqa: E402


def key(name: str) -> uuid.UUID:
    return uuid.uuid5(uuid.NAMESPACE_URL, f"edgeos-local-rsvp-validation/{name}")


def assert_local() -> None:
    s = config.settings
    if (
        s.POSTGRES_SERVER != "127.0.0.1"
        or s.POSTGRES_PORT != 25432
        or s.POSTGRES_DB != "edgeos_rsvp_validation"
        or s.ENVIRONMENT != config.Environment.DEV
        or s.emails_enabled
        or s.storage_enabled
    ):
        raise RuntimeError(
            "Refusing to run outside the isolated local fixture database"
        )


def manifest(db: Session) -> dict:
    from app.api.event.models import Events

    event = db.get(Events, key("series"))
    if event is None:
        raise RuntimeError("Run seed first")
    start = event.start_time
    second = start + timedelta(days=2)
    series_id = str(event.id)
    return {
        "tenant_id": str(key("tenant")),
        "popup_id": str(key("popup")),
        "popup_slug": "rsvp-lab",
        "series_id": series_id,
        "first_occurrence": start.isoformat(),
        "second_occurrence": second.isoformat(),
        "detached_id": str(key("detached")),
        "oneoff_id": str(key("oneoff")),
        "live_id": str(key("live")),
        "backoffice_first": f"http://localhost:5173/events/{series_id}",
        "backoffice_second": f"http://localhost:5173/events/{series_id}?{urlencode({'occ': second.isoformat()})}",
        "portal_first": f"http://localhost:3000/portal/rsvp-lab/events/{series_id}",
        "portal_second": f"http://localhost:3000/portal/rsvp-lab/events/{series_id}?{urlencode({'occ': second.isoformat()})}",
        "expected_series_counts": [4, 3, "detached: 2", 0, 5, 1],
        "privacy": "Sofia counts toward capacity but her name is hidden in the portal",
        "emails": "disabled; browser helper bypasses OTP only for these local fixtures",
    }


def seed() -> dict:
    from app.api.application.models import Applications
    from app.api.application.schemas import ApplicationStatus
    from app.api.attendee.models import AttendeeProducts, Attendees
    from app.api.event.models import Events
    from app.api.event.schemas import AttendanceMode, EventStatus, EventVisibility
    from app.api.event_participant.models import EventParticipants
    from app.api.event_participant.schemas import ParticipantStatus
    from app.api.event_settings.models import EventSettings
    from app.api.event_venue.models import EventVenues
    from app.api.human.models import Humans
    from app.api.popup.models import Popups
    from app.api.popup.schemas import PopupStatus
    from app.api.product.models import Products
    from app.api.sales_flow.crud import sales_flows_crud
    from app.api.shared.enums import UserRole
    from app.api.tenant.models import Tenants
    from app.api.ticketing_step.constants import seed_ticketing_steps_for_popup
    from app.api.user.models import Users
    from app.core.tenant_db import ensure_tenant_credentials

    with Session(engine) as db:
        if db.get(Tenants, key("tenant")):
            return manifest(db)
        tenant = Tenants(
            id=key("tenant"),
            name="RSVP Validation Lab",
            slug="rsvp-lab",
            custom_domain="localhost",
            custom_domain_active=True,
        )
        db.add(tenant)
        db.commit()
        ensure_tenant_credentials(db, tenant.id)
        db.add(
            Users(
                id=key("admin"),
                email="admin.rsvp@example.com",
                full_name="Ana QA Admin",
                role=UserRole.ADMIN,
                tenant_id=tenant.id,
            )
        )
        people = {}
        for name, first, last in [
            ("organizer", "Ana", "Organizadora"),
            ("maria", "Maria", "Lopez"),
            ("bruno", "Bruno", "Silva"),
            ("diego", "Diego", "Perez"),
            ("sofia", "Sofia", "Privada"),
            ("pablo", "Pablo", "Cancelado"),
            ("valeria", "Valeria", "Nueva"),
        ]:
            human = Humans(
                id=key(name),
                tenant_id=tenant.id,
                first_name=first,
                last_name=last,
                email="admin.rsvp@example.com"
                if name == "organizer"
                else f"{name}.rsvp@example.com",
            )
            db.add(human)
            people[name] = human
        db.flush()
        now = datetime.now(UTC)
        day = (now + timedelta(days=1)).date()
        while day.weekday() != 1:
            day += timedelta(days=1)
        start = datetime(day.year, day.month, day.day, 3, 30, tzinfo=UTC)
        dates = [start + timedelta(days=d) for d in (0, 2, 7, 9, 14, 16)]
        popup = Popups(
            id=key("popup"),
            tenant_id=tenant.id,
            name="RSVP Lab — Recurring Events",
            slug="rsvp-lab",
            status=PopupStatus.active,
            events_enabled=True,
            start_date=(now - timedelta(days=1)).replace(tzinfo=None),
            end_date=(dates[-1] + timedelta(days=7)).replace(tzinfo=None),
            location="Local fixtures — India timezone",
            default_language="en",
        )
        db.add(popup)
        db.flush()
        flow = sales_flows_crud.provision_default_flow(
            db,
            popup_id=popup.id,
            tenant_id=tenant.id,
            sale_type="application",
        )
        seed_ticketing_steps_for_popup(
            db,
            popup_id=popup.id,
            tenant_id=tenant.id,
            sales_flow_id=flow.id,
            flow_type=flow.type,
        )
        db.add(
            EventSettings(
                tenant_id=tenant.id,
                popup_id=popup.id,
                event_enabled=True,
                timezone="Asia/Kolkata",
                events_require_approval=False,
                venues_require_approval=False,
            )
        )
        venue = EventVenues(
            id=key("venue"),
            tenant_id=tenant.id,
            popup_id=popup.id,
            owner_id=people["organizer"].id,
            title="QA Yoga Studio",
            location="Mock venue — no real address",
            capacity=5,
        )
        db.add(venue)
        ticket = Products(
            id=key("ticket"),
            tenant_id=tenant.id,
            popup_id=popup.id,
            name="QA gathering pass",
            slug="qa-pass",
            price=Decimal("0"),
            category="ticket",
        )
        db.add(ticket)
        db.flush()
        for name, human in people.items():
            app = Applications(
                id=key(f"application-{name}"),
                tenant_id=tenant.id,
                popup_id=popup.id,
                sales_flow_id=flow.id,
                human_id=human.id,
                status=ApplicationStatus.ACCEPTED.value,
                info_not_shared=["first_name", "last_name"] if name == "sofia" else [],
            )
            attendee = Attendees(
                id=key(f"attendee-{name}"),
                tenant_id=tenant.id,
                popup_id=popup.id,
                application_id=app.id,
                human_id=human.id,
                name=f"{human.first_name} {human.last_name}",
                email=human.email,
            )
            db.add(app)
            db.flush()
            db.add(attendee)
            db.flush()
            db.add(
                AttendeeProducts(
                    tenant_id=tenant.id,
                    attendee_id=attendee.id,
                    product_id=ticket.id,
                    check_in_code=f"local-rsvp-{name}",
                    product_category_snapshot="ticket",
                )
            )
        common = {
            "tenant_id": tenant.id,
            "popup_id": popup.id,
            "owner_id": people["organizer"].id,
            "host_id": people["organizer"].id,
            "host_display_name": "Ana — QA organizer",
            "venue_id": venue.id,
            "timezone": "Asia/Kolkata",
            "max_participant": 5,
            "status": EventStatus.PUBLISHED,
            "visibility": EventVisibility.PUBLIC,
            "attendance_mode": AttendanceMode.SELF_CHECKIN,
        }
        series = Events(
            id=key("series"),
            title="QA Yoga — six dates, independent RSVPs",
            content="Synthetic data. First date: 4 seats (3 visible names). Second: 3 seats (2 visible names), plus a cancelled RSVP. One date is detached; another is empty; another is full.",
            start_time=dates[0],
            end_time=dates[0] + timedelta(minutes=90),
            rrule="FREQ=WEEKLY;BYDAY=TU,TH;COUNT=6",
            recurrence_exdates=[dates[2].isoformat()],
            **common,
        )
        child = Events(
            id=key("detached"),
            title="QA Yoga — detached date at 10:00",
            start_time=dates[2] + timedelta(hours=1),
            end_time=dates[2] + timedelta(hours=2, minutes=30),
            recurrence_master_id=series.id,
            **common,
        )
        oneoff = Events(
            id=key("oneoff"),
            title="QA Community Lunch — one-off",
            start_time=dates[0] + timedelta(hours=4),
            end_time=dates[0] + timedelta(hours=5),
            **common,
        )
        live = Events(
            id=key("live"),
            title="QA Live Roll Call — check-in validation",
            start_time=now - timedelta(minutes=10),
            end_time=now + timedelta(minutes=50),
            **common,
        )
        db.add_all([series, child, oneoff, live])
        db.flush()

        def rsvp(event, name, occurrence=None, status=ParticipantStatus.REGISTERED):
            db.add(
                EventParticipants(
                    id=key(f"rsvp-{event.id}-{name}-{occurrence}"),
                    tenant_id=tenant.id,
                    event_id=event.id,
                    profile_id=people[name].id,
                    occurrence_start=occurrence,
                    status=status,
                )
            )

        for index, names in {
            0: ["maria", "bruno", "diego", "sofia"],
            1: ["maria", "bruno", "sofia"],
            4: ["maria", "bruno", "diego", "sofia", "pablo"],
            5: ["maria"],
        }.items():
            for name in names:
                rsvp(series, name, dates[index])
        rsvp(series, "pablo", dates[1], ParticipantStatus.CANCELLED)
        # Legacy host participation must never appear/count as an attendee.
        rsvp(series, "organizer", dates[0])
        for name in ["maria", "diego"]:
            rsvp(child, name)
        for name in ["maria", "bruno"]:
            rsvp(oneoff, name)
            rsvp(live, name)
        db.commit()
        return manifest(db)


def validate() -> None:
    """Check the live local API without changing fixture rows or sending email."""
    import httpx

    from app.core.security import create_access_token

    with Session(engine) as db:
        data = manifest(db)
    tokens = {
        name: create_access_token(subject=key(name), token_type=kind)
        for name, kind in [("admin", "user"), ("maria", "human"), ("valeria", "human")]
    }
    responses = 0
    with httpx.Client(
        base_url="http://localhost:8000/api/v1", trust_env=False, timeout=15
    ) as client:

        def request(method, path, account="admin", expected=200, **kwargs):
            nonlocal responses
            response = client.request(
                method,
                path,
                headers={
                    "Authorization": f"Bearer {tokens[account]}",
                    "X-Tenant-Id": data["tenant_id"],
                },
                **kwargs,
            )
            assert response.status_code == expected, (
                path,
                response.status_code,
                response.text,
            )
            responses += 1
            return response.json()

        first = datetime.fromisoformat(data["first_occurrence"])
        series = data["series_id"]
        for prefix, account in [
            ("/events", "admin"),
            ("/events/portal/events", "maria"),
        ]:
            for days, count in [(0, 4), (2, 3), (9, 0), (14, 5), (16, 1)]:
                occurrence = first + timedelta(days=days)
                event = request(
                    "GET",
                    f"{prefix}/{series}",
                    account=account,
                    params={"occurrence_start": occurrence.isoformat()},
                )
                assert datetime.fromisoformat(event["start_time"]) == occurrence
                assert (
                    datetime.fromisoformat(event["resolved_occurrence_start"])
                    == occurrence
                )
                assert event["attendee_count"] == count
            default = request("GET", f"{prefix}/{series}", account=account)
            assert datetime.fromisoformat(default["resolved_occurrence_start"]) == first
            child = request("GET", f"{prefix}/{data['detached_id']}", account=account)
            assert child["resolved_occurrence_start"] is None
            assert child["attendee_count"] == 2
            if account == "maria":
                assert child["my_rsvp_status"] == "registered"
            for invalid in [first + timedelta(minutes=1), first + timedelta(days=7)]:
                request(
                    "GET",
                    f"{prefix}/{series}",
                    account=account,
                    expected=400,
                    params={"occurrence_start": invalid.isoformat()},
                )
            request(
                "GET",
                f"{prefix}/{data['detached_id']}",
                account=account,
                expected=400,
                params={"occurrence_start": first.isoformat()},
            )
        for occurrence, count, names in [
            (first, 4, {"Maria", "Bruno", "Diego"}),
            (first + timedelta(days=2), 3, {"Maria", "Bruno"}),
        ]:
            params = {"event_id": series, "occurrence_start": occurrence.isoformat()}
            admin = request("GET", "/event-participants", params=params)
            active = [p for p in admin["results"] if p["status"] != "cancelled"]
            assert len(active) == count
            assert all(
                p["profile_id"] != str(key("organizer")) for p in admin["results"]
            )
            portal = request(
                "GET",
                "/event-participants/portal/participants",
                account="maria",
                params=params,
            )
            visible = {
                p["first_name"] for p in portal["results"] if p["status"] != "cancelled"
            }
            assert visible == names
        duplicate = request(
            "POST",
            f"/event-participants/portal/register/{series}",
            account="maria",
            expected=409,
            json={"occurrence_start": first.isoformat()},
        )
        assert duplicate["detail"] == "Already registered"
        full = request(
            "POST",
            f"/event-participants/portal/register/{series}",
            account="valeria",
            expected=409,
            json={"occurrence_start": (first + timedelta(days=14)).isoformat()},
        )
        assert full["detail"] == "Event is full"
    print(  # noqa: T201
        f"PASS: {responses} live API checks; date/count/privacy/detached/invalid/duplicate/capacity; no fixture rows changed"
    )


def browser(account: str, surface: str, headed: bool) -> None:
    from app.core.security import create_access_token

    bo = surface == "backoffice"
    if bo and account != "admin":
        raise RuntimeError("Backoffice account must be admin")
    if not bo and account == "admin":
        raise RuntimeError("Use organizer or an attendee for the portal")
    with Session(engine) as db:
        data = manifest(db)
    token = create_access_token(
        subject=key(account), token_type="user" if bo else "human"
    )
    origins = (
        ["http://localhost:5173"]
        if bo
        else ["http://localhost", "http://localhost:3000"]
    )
    session = f"rsvp-local-{surface}-{account}"
    command = ["agent-browser", "--session", session]
    values = (
        {
            "access_token": token,
            "workspace_tenant_id": data["tenant_id"],
            "workspace_popup_id": data["popup_id"],
        }
        if bo
        else {"token": token, "portal_tenant_id": data["tenant_id"]}
    )
    for origin in origins:
        subprocess.run(
            [*command, *(["--headed"] if headed else []), "open", origin], check=True
        )
        js = f"if (location.origin !== {json.dumps(origin)}) throw new Error('Not a local origin');\n"
        js += (
            "for (const [k,v] of Object.entries("
            + json.dumps(values)
            + ")) localStorage.setItem(k,v);\n"
        )
        js += "'Local synthetic account configured; no emails sent'"
        subprocess.run([*command, "eval", "--stdin"], input=js, text=True, check=True)
    subprocess.run(
        [*command, "open", data["backoffice_first" if bo else "portal_first"]],
        check=True,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command", choices=["migrate", "seed", "serve", "browser", "validate"]
    )
    parser.add_argument("--surface", choices=["backoffice", "portal"], default="portal")
    parser.add_argument(
        "--account", choices=["admin", "organizer", "maria", "valeria"], default="maria"
    )
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args()
    assert_local()
    os.chdir(BACKEND)
    if args.command == "migrate":
        from alembic import command
        from alembic.config import Config

        with engine.begin() as connection:
            cfg = Config("alembic.ini")
            cfg.attributes["connection"] = connection
            command.upgrade(cfg, "head")
    elif args.command == "seed":
        print(json.dumps(seed(), indent=2))  # noqa: T201
    elif args.command == "validate":
        validate()
    elif args.command == "serve":
        import uvicorn

        uvicorn.run("app.main:application", host="127.0.0.1", port=8000)
    else:
        browser(args.account, args.surface, args.headed)


if __name__ == "__main__":
    main()
