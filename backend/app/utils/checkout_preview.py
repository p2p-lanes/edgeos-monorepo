"""Short-lived tokens that unlock the checkout runtime for backoffice previews.

The public runtime endpoint only serves popups that are ``sale_type=direct`` and
``status=active`` — which is exactly what an operator does NOT have while they
are still configuring the event (popups are created as ``draft``). The live
preview in the backoffice embeds the real portal checkout in an iframe, so it
needs that same endpoint to answer for a draft popup without opening it to the
public.

A preview token is a normal platform JWT with ``token_type="checkout_preview"``
and the popup id as its subject, minted only for an authenticated operator. It
carries no scopes and unlocks nothing but the read-only runtime payload of the
one popup it names, for 15 minutes.
"""

import uuid
from datetime import UTC, datetime, timedelta

from app.core.security import create_access_token, decode_access_token

#: ``token_type`` claim that marks a JWT as a checkout preview token.
CHECKOUT_PREVIEW_TOKEN_TYPE = "checkout_preview"

#: How long a minted preview token stays valid.
CHECKOUT_PREVIEW_TOKEN_TTL = timedelta(minutes=15)

#: Header the portal sends the token in. A header rather than a query param so
#: the token never lands in access logs or the browser's history.
CHECKOUT_PREVIEW_TOKEN_HEADER = "X-Checkout-Preview-Token"


def mint_checkout_preview_token(popup_id: uuid.UUID) -> tuple[str, datetime]:
    """Mint a preview token for ``popup_id``. Returns ``(token, expires_at)``."""
    expires_at = datetime.now(UTC) + CHECKOUT_PREVIEW_TOKEN_TTL
    token = create_access_token(
        subject=popup_id,
        token_type=CHECKOUT_PREVIEW_TOKEN_TYPE,
        expires_delta=CHECKOUT_PREVIEW_TOKEN_TTL,
    )
    return token, expires_at


def resolve_preview_popup_id(token: str | None) -> uuid.UUID | None:
    """Return the popup id a preview token authorizes, or None.

    None means "no preview requested" — the caller keeps the public behaviour.
    A malformed, expired or non-preview token raises 401 via
    :func:`decode_access_token` rather than silently degrading, so a stale
    iframe reports the real reason instead of an unrelated 403.

    The token is not tenant-bound: the caller resolves the popup by slug within
    the request's tenant and compares ids, so a token from another tenant can
    never match.
    """
    if not token:
        return None

    payload = decode_access_token(token)
    if payload.token_type != CHECKOUT_PREVIEW_TOKEN_TYPE:
        return None

    try:
        return uuid.UUID(payload.sub)
    except ValueError:
        return None
