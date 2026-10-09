"""Create a repeatable SSO fixture in the isolated local DB, never a remote DB.

Run from backend with the example env sourced:
    uv run python ../examples/third-party-sso/seed.py
"""

import json
import sys
from datetime import UTC, datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from sqlmodel import Session, select  # noqa: E402

import app.models  # noqa: E402, F401 — register all relationship targets

from app.api.human.models import Humans  # noqa: E402
from app.api.popup import crud as popup_crud  # noqa: E402
from app.api.popup.models import PopupHomePages, Popups  # noqa: E402
from app.api.popup.schemas import PopupCreate, PopupStatus  # noqa: E402
from app.api.tenant.models import Tenants  # noqa: E402
from app.api.third_party_app import crud as app_crud  # noqa: E402
from app.api.third_party_app.models import ThirdPartyApps  # noqa: E402
from app.api.third_party_app.schemas import ThirdPartyAppUpdate  # noqa: E402
from app.api.third_party_sso.models import PopupThirdPartyApps  # noqa: E402
from app.api.user.models import Users  # noqa: E402
from app.core.config import Environment, settings  # noqa: E402
from app.core.db import engine  # noqa: E402
from app.core.security import create_access_token  # noqa: E402

if settings.ENVIRONMENT != Environment.DEV or settings.POSTGRES_SERVER not in ("localhost", "127.0.0.1") or settings.POSTGRES_DB != "edgeos_sso":
    raise SystemExit("Refusing to seed anything except local edgeos_sso in dev")

folder = Path(__file__).parent
with Session(engine) as db:
    tenant = db.exec(select(Tenants).where(Tenants.slug == "demo")).one()
    popup = db.exec(select(Popups).where(Popups.tenant_id == tenant.id, Popups.slug == "sso-test")).first()
    if not popup:
        popup = popup_crud.create(db, PopupCreate(tenant_id=tenant.id, name="SSO test", slug="sso-test", status=PopupStatus.active))
    popup.custom_home_enabled = True
    popup.status = PopupStatus.active
    popup.start_date = datetime.now(UTC)
    popup.end_date = popup.start_date + timedelta(days=7)
    db.add(popup)
    human = db.exec(select(Humans).where(Humans.tenant_id == tenant.id, Humans.email == "sso@example.com")).first()
    if not human:
        human = Humans(tenant_id=tenant.id, email="sso@example.com", first_name="SSO", last_name="Tester")
        db.add(human)
        db.commit()
        db.refresh(human)
    app = db.exec(select(ThirdPartyApps).where(ThirdPartyApps.tenant_id == tenant.id, ThirdPartyApps.name == "SSO mock", ThirdPartyApps.revoked_at.is_(None))).first()
    if not app:
        app, raw_key = app_crud.create(db, tenant.id, name="SSO mock", allowed_token_scopes=["portal:profile:read"], allowed_api_key_scopes=[], sso_start_url="http://localhost:4000/auth/start", sso_redirect_uri="http://localhost:4000/auth/callback")
    else:
        app = app_crud.update(db, app, ThirdPartyAppUpdate(sso_start_url="http://localhost:4000/auth/start", sso_redirect_uri="http://localhost:4000/auth/callback", allowed_token_scopes=["portal:profile:read"]))
        app, raw_key = app_crud.rotate_key(db, app)
    link = db.get(PopupThirdPartyApps, (popup.id, app.id)) or PopupThirdPartyApps(popup_id=popup.id, app_id=app.id, tenant_id=tenant.id)
    link.enabled = True
    db.add(link)
    launch_path = f"/portal/{popup.slug}/apps/{app.id}/launch"
    home = db.get(PopupHomePages, popup.id) or PopupHomePages(popup_id=popup.id, tenant_id=tenant.id)
    home.html = f'''<style>body{{font:16px/1.6 system-ui;padding:32px;color:#183453}}a{{display:inline-block;background:#285bc5;color:white;padding:12px 20px;border-radius:8px;text-decoration:none}}</style><h1>SSO test</h1><p>Usuario autenticado en EdgeOS. Abrí el mock sin un segundo OTP.</p><a href="{launch_path}">Abrir app mock</a>'''
    home.version += 1
    db.add(home)
    db.commit()
    portal = "http://demo.localhost:3000"
    env = f"BACKEND_URL=http://localhost:8000\nAPP_KEY={raw_key}\nAUTHORIZE_URL={portal}{launch_path.removesuffix('/launch')}/authorize\nCALLBACK_URL=http://localhost:4000/auth/callback\n"
    env_path = folder / ".env.local"
    env_path.write_text(env)
    env_path.chmod(0o600)
    # Local-only browser convenience; never print JWTs or commit this file.
    admin = db.exec(select(Users).where(Users.email == settings.SUPERADMIN)).one()
    session_path = folder / ".sessions.local"
    session_path.write_text(json.dumps({"portal_url": f"{portal}/portal/{popup.slug}", "human_email": human.email, "human_token": create_access_token(human.id, token_type="human"), "admin_token": create_access_token(admin.id, token_type="user"), "tenant_id": str(tenant.id), "popup_id": str(popup.id), "app_id": str(app.id)}))
    session_path.chmod(0o600)
    sys.stdout.write(f"Seed ready: {portal}/portal/{popup.slug}\nHuman: {human.email} (no application required)\nMock config: {env_path.name} (restart mock after re-seeding)\n")
