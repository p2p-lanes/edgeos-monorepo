"""Shared visibility check for published custom homes and their app launches."""

import uuid

from fastapi import HTTPException
from sqlmodel import Session, select

from app.api.application.crud import applications_crud
from app.api.popup.models import PopupHomePages, Popups
from app.api.popup.schemas import PopupStatus


def get_accessible_home(
    db: Session, slug: str, tenant_id: uuid.UUID, human_id: uuid.UUID
) -> tuple[Popups, PopupHomePages]:
    popup = db.exec(
        select(Popups).where(Popups.slug == slug, Popups.tenant_id == tenant_id)
    ).first()
    if not popup or popup.status not in (PopupStatus.active, PopupStatus.ended):
        raise HTTPException(status_code=404, detail="Home page not found")
    if (
        popup.status == PopupStatus.ended
        and not applications_crud.resolve_popup_access(db, human_id, popup.id).allowed
    ):
        raise HTTPException(status_code=404, detail="Home page not found")
    home = db.get(PopupHomePages, popup.id)
    if (
        not popup.custom_home_enabled
        or not home
        or not home.html
        or not home.html.strip()
    ):
        raise HTTPException(status_code=404, detail="Home page not found")
    return popup, home
