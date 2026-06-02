"""Resolved identity of whoever performed an audited action.

An actor can be a backoffice ``User`` (token type ``user``) or a portal
``Human`` (token type ``human``), so it is stored as flat snapshot fields rather
than a foreign key. Build one with :func:`actor_from_user` /
:func:`actor_from_human` and hand it to ``audit_logs_crud.record``.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from enum import Enum
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.api.human.schemas import HumanPublic
    from app.api.user.schemas import UserPublic


class AuditSource(str, Enum):
    """Originating application."""

    PORTAL = "portal"
    BACKOFFICE = "backoffice"
    SYSTEM = "system"


class AuditActorType(str, Enum):
    USER = "user"
    HUMAN = "human"
    API_KEY = "api_key"
    SYSTEM = "system"


@dataclass(frozen=True)
class AuditActor:
    """Resolved identity + origin of whoever performed an action."""

    type: AuditActorType
    source: AuditSource
    id: uuid.UUID | None = None
    email: str | None = None
    name: str | None = None


def actor_from_user(current_user: UserPublic) -> AuditActor:
    """Build an actor for a backoffice (staff) user."""
    return AuditActor(
        type=AuditActorType.USER,
        source=AuditSource.BACKOFFICE,
        id=current_user.id,
        email=getattr(current_user, "email", None),
        name=getattr(current_user, "full_name", None)
        or getattr(current_user, "email", None),
    )


def actor_from_human(current_human: HumanPublic) -> AuditActor:
    """Build an actor for a portal (community) human."""
    first = getattr(current_human, "first_name", None) or ""
    last = getattr(current_human, "last_name", None) or ""
    name = f"{first} {last}".strip() or None
    return AuditActor(
        type=AuditActorType.HUMAN,
        source=AuditSource.PORTAL,
        id=current_human.id,
        email=getattr(current_human, "email", None),
        name=name,
    )
