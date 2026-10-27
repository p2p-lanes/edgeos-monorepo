"""Public profiles: the share token, and its readable alias.

A profile is reached by its opaque token (``/u/<token>``) or by the alias the
person picked (portal.<tenant>/<username>). The alias shares the portal's root path with popup slugs (``/[popupSlug]``)
and the portal's own top-level routes, so neither can be taken as a username.
A popup created later with someone's username wins: the public lookup refuses
any slug a popup holds.
"""

import re
import uuid

from sqlmodel import Session, func, select

from app.api.human.models import Humans

USERNAME_MIN = 3
USERNAME_MAX = 30

# Lowercase letters, digits, "-" and "_", starting and ending with a letter or
# digit, so the alias reads cleanly in a URL.
_USERNAME_RE = re.compile(r"^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$")

# Top-level portal routes (portal/src/app) plus names people would expect to
# be the platform's own.
RESERVED_USERNAMES = frozenset(
    {
        "about",
        "admin",
        "api",
        "auth",
        "checkout",
        "coming-soon",
        "groups",
        "help",
        "icons",
        "invite",
        "login",
        "logout",
        "me",
        "portal",
        "privacy",
        "profile",
        "settings",
        "signup",
        "static",
        "support",
        "terms",
        "www",
    }
)


class UsernameError(ValueError):
    """The username is malformed or reserved."""


def normalize_username(raw: str) -> str:
    """Lowercase and validate ``raw``; raises UsernameError when unusable."""
    value = raw.strip().lower()
    if not USERNAME_MIN <= len(value) <= USERNAME_MAX:
        raise UsernameError(
            f"A username has {USERNAME_MIN} to {USERNAME_MAX} characters"
        )
    if not _USERNAME_RE.match(value):
        raise UsernameError(
            "Use lowercase letters, numbers, '-' and '_', "
            "starting and ending with a letter or number"
        )
    if value in RESERVED_USERNAMES:
        raise UsernameError("That username is reserved")
    return value


def is_popup_slug(db: Session, tenant_id, slug: str) -> bool:
    """Whether a popup of the tenant (in any status) uses ``slug``.

    Filters by tenant explicitly so it also holds on an unscoped session.
    """
    from app.api.popup.models import Popups

    return (
        db.exec(
            select(Popups.id).where(
                Popups.tenant_id == tenant_id, func.lower(Popups.slug) == slug
            )
        ).first()
        is not None
    )


def find_shared_profile(
    db: Session,
    tenant_id: uuid.UUID,
    *,
    token: str | None = None,
    username: str | None = None,
) -> Humans | None:
    """The human behind a token or alias, if their profile is shared.

    Unknown, regenerated, disabled and sibling-tenant handles all return None,
    so callers can answer with one opaque 404. An alias a popup slug now holds
    resolves to nobody: the popup wins the path.
    """
    if token:
        statement = select(Humans).where(Humans.public_profile_token == token)
    elif username:
        username = username.strip().lower()
        if is_popup_slug(db, tenant_id, username):
            return None
        statement = select(Humans).where(
            Humans.tenant_id == tenant_id, Humans.username == username
        )
    else:
        return None
    human = db.exec(statement).first()
    if not human or human.tenant_id != tenant_id or not human.public_profile_enabled:
        return None
    return human
