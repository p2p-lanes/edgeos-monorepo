"""Self-serve trial signup + provisioning.

Flow (public, no auth):
  1. POST /trials          -> store pending trial (Redis, DB fallback) + email OTP
  2. POST /trials/verify   -> verify OTP, then provision tenant + admin user +
                              draft popup, return a user JWT.

Pending storage mirrors the pending-humans pattern in app/api/auth/crud.py:
Redis first (15-min TTL), pending_trials table as fallback. OTP verification
allows MAX_AUTH_ATTEMPTS attempts, like the passwordless login flows.
"""

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException, status
from loguru import logger
from sqlalchemy.exc import IntegrityError
from sqlmodel import Session, func, not_, select

from app.api.auth.crud import CODE_EXPIRATION_MINUTES, MAX_AUTH_ATTEMPTS
from app.api.auth.utils import (
    create_code_expiration,
    generate_auth_code,
    is_code_valid,
)
from app.api.popup.crud import popups_crud
from app.api.popup.models import Popups
from app.api.popup.schemas import PopupCreate
from app.api.shared.enums import UserRole
from app.api.tenant.crud import tenants_crud
from app.api.tenant.models import Tenants
from app.api.tenant.schemas import TenantCreate
from app.api.trial.models import PendingTrials
from app.api.user.models import Users
from app.core.config import settings
from app.core.redis import (
    auth_code_store,
    is_redis_available,
    pending_trial_store,
)
from app.core.security import create_access_token
from app.services.email import (
    LoginCodeUserContext,
    TrialWelcomeContext,
    get_email_service,
)
from app.utils.utils import slugify

TRIAL_DURATION_DAYS = 7

# How many slug candidates to try before giving up (base, base-2, ... base-N).
_MAX_SLUG_ATTEMPTS = 50


def _find_active_trial_tenant(session: Session, email: str) -> Tenants | None:
    """Return the non-suspended trial tenant whose ADMIN user has this email.

    Suspended (expired) trials do NOT block a new signup — only a currently
    active trial does.
    """
    statement = (
        select(Tenants)
        .join(Users, Users.tenant_id == Tenants.id)  # type: ignore[arg-type]
        .where(
            func.lower(Users.email) == email.lower(),
            not_(Users.deleted),
            Users.role == UserRole.ADMIN,
            Tenants.is_trial == True,  # noqa: E712
            Tenants.suspended_at.is_(None),  # type: ignore[union-attr]
            Tenants.deleted == False,  # noqa: E712
        )
    )
    return session.exec(statement).first()


def _get_pending_trial_row(session: Session, email: str) -> PendingTrials | None:
    statement = select(PendingTrials).where(PendingTrials.email == email.lower())
    return session.exec(statement).first()


def _has_pending_trial(session: Session, email: str) -> bool:
    if is_redis_available():
        return pending_trial_store.get(email) is not None

    row = _get_pending_trial_row(session, email)
    if row is None:
        return False
    expiration = row.code_expiration
    if expiration.tzinfo is None:
        expiration = expiration.replace(tzinfo=UTC)
    return expiration > datetime.now(UTC)


async def start_trial(
    session: Session,
    *,
    gathering_name: str,
    email: str,
) -> tuple[str, int]:
    """Store a pending trial and email a 6-digit verification code.

    Raises 409 when an active trial (pending or provisioned, non-suspended)
    already exists for this email.
    Returns (email, CODE_EXPIRATION_MINUTES).
    """
    email = email.lower().strip()

    if _find_active_trial_tenant(session, email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An active trial already exists for this email",
        )

    if _has_pending_trial(session, email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="A trial verification is already pending for this email",
        )

    auth_code = generate_auth_code()

    if is_redis_available():
        pending_trial_store.store(email=email, gathering_name=gathering_name)
        auth_code_store.store_trial_code(email, auth_code)
        logger.debug(f"Pending trial stored in Redis: {email}")
    else:
        code_expiration = create_code_expiration(CODE_EXPIRATION_MINUTES)
        row = _get_pending_trial_row(session, email)
        if row:
            # Expired leftover — reuse the row with a fresh code.
            row.gathering_name = gathering_name
            row.auth_code = auth_code
            row.code_expiration = code_expiration
            row.attempts = 0
        else:
            row = PendingTrials(
                email=email,
                gathering_name=gathering_name,
                auth_code=auth_code,
                code_expiration=code_expiration,
                attempts=0,
            )
        session.add(row)
        session.commit()
        logger.debug(f"Pending trial stored in database: {email}")

    # Same email format as the passwordless login flows; tenant_id=None so
    # delivery uses the global SMTP fallback.
    email_service = get_email_service()
    success = await email_service.send_login_code_user(
        to=email,
        subject=f"Your Verification Code - {settings.PROJECT_NAME}",
        context=LoginCodeUserContext(
            user_name=None,
            tenant_name=settings.PROJECT_NAME,
            auth_code=auth_code,
            expiration_minutes=CODE_EXPIRATION_MINUTES,
        ),
        tenant_id=None,
        db_session=session,
    )

    if not success:
        logger.error(f"Failed to send trial verification code to {email}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to send verification code",
        )

    logger.info(f"Trial verification code sent to: {email}")
    return email, CODE_EXPIRATION_MINUTES


def _verify_code_and_pop_pending(
    session: Session,
    email: str,
    code: str,
) -> str:
    """Verify the OTP and return the pending gathering_name.

    Mirrors the pending-human verification: Redis first, DB fallback with a
    MAX_AUTH_ATTEMPTS cap. The pending record itself is deleted later, after
    provisioning succeeds (Redis codes are consumed on successful verify).
    """
    if is_redis_available():
        is_valid, error_message = auth_code_store.verify_trial_code(email, code)
        if not is_valid:
            if "Maximum" in error_message:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=error_message,
                )
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=error_message,
            )

        pending_data = pending_trial_store.get(email)
        if not pending_data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No pending trial found",
            )
        return pending_data["gathering_name"]

    row = _get_pending_trial_row(session, email)
    if row is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No pending trial found",
        )

    if row.attempts >= MAX_AUTH_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Maximum verification attempts exceeded. Please request a new code.",
        )

    is_valid, error_message = is_code_valid(
        stored_code=row.auth_code,
        provided_code=code,
        expiration=row.code_expiration,
    )
    if not is_valid:
        row.attempts += 1
        session.add(row)
        session.commit()
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=error_message,
        )

    return row.gathering_name


def _delete_pending_trial(session: Session, email: str) -> None:
    if is_redis_available():
        pending_trial_store.delete(email)
        return
    row = _get_pending_trial_row(session, email)
    if row is not None:
        session.delete(row)
        session.commit()


def _unique_tenant_slug(session: Session, name: str) -> str:
    """Slugify the gathering name and disambiguate collisions with -2, -3, ...

    Unlike POST /tenants (which 400s on collision), the self-serve flow must
    always succeed: a visitor cannot be asked to pick a different slug.
    """
    base = slugify(name) or "gathering"
    base = base[:240]  # leave room for the numeric suffix within max_length

    if tenants_crud.get_by_slug(session, base) is None:
        return base

    for suffix in range(2, _MAX_SLUG_ATTEMPTS + 2):
        candidate = f"{base}-{suffix}"
        if tenants_crud.get_by_slug(session, candidate) is None:
            return candidate

    # Astronomically unlikely — fall back to a random suffix.
    return f"{base}-{uuid.uuid4().hex[:8]}"


def provision_trial(
    session: Session,
    *,
    gathering_name: str,
    email: str,
) -> tuple[Tenants, Users, Popups]:
    """Provision the trial: tenant + first ADMIN user + draft popup.

    The OTP already proved possession of the email, so the ADMIN user is
    created internally (POST /users normally requires a higher-ranked actor).
    The tenant starts EMPTY except for one draft popup named after the
    gathering — no sample data (spec decision #3).
    """
    email = email.lower().strip()

    # Tenant — TenantCreate regenerates slug from name in its validator, so
    # the disambiguated slug is assigned after construction.
    tenant_in = TenantCreate(name=gathering_name)

    tenant: Tenants | None = None
    for _ in range(3):
        tenant_in.slug = _unique_tenant_slug(session, gathering_name)
        try:
            # TenantsCRUD.create also provisions the tenant's PG credentials
            # via ensure_tenant_credentials.
            tenant = tenants_crud.create(session, tenant_in)
            break
        except IntegrityError:
            # Slug race with a concurrent create — retry with a fresh suffix.
            session.rollback()
    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not provision trial workspace",
        )

    tenant.is_trial = True
    tenant.trial_expires_at = datetime.now(UTC) + timedelta(days=TRIAL_DURATION_DAYS)
    session.add(tenant)
    session.commit()
    session.refresh(tenant)

    user = Users(
        email=email,
        role=UserRole.ADMIN,
        tenant_id=tenant.id,
    )
    session.add(user)
    session.commit()
    session.refresh(user)

    # Draft popup named after the gathering. PopupsCRUD.create seeds the main
    # attendee category and the open_checkout_signing_secret.
    popup = popups_crud.create(
        session,
        PopupCreate(tenant_id=tenant.id, name=gathering_name),
    )

    logger.info(
        f"Trial provisioned: tenant={tenant.id} slug={tenant.slug} "
        f"admin={email} popup={popup.id}"
    )
    return tenant, user, popup


async def verify_trial(
    session: Session,
    *,
    email: str,
    code: str,
) -> tuple[Tenants, Users, Popups, str]:
    """Verify the OTP and provision the trial.

    Returns (tenant, user, popup, access_token)."""
    email = email.lower().strip()

    gathering_name = _verify_code_and_pop_pending(session, email, code)

    # Race guard: a concurrent verify may have provisioned already.
    if _find_active_trial_tenant(session, email):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An active trial already exists for this email",
        )

    tenant, user, popup = provision_trial(
        session, gathering_name=gathering_name, email=email
    )

    _delete_pending_trial(session, email)

    access_token = create_access_token(subject=user.id, token_type="user")

    # The welcome email's button is a magic link: the token rides in the URL
    # fragment, which browsers never send to the server (stays out of access
    # logs and Referer headers). The OTP already proved email possession, so
    # this grants nothing an emailed login code wouldn't. Token TTL
    # (ACCESS_TOKEN_EXPIRE_MINUTES = 8 days) outlives the 7-day trial.
    login_url = f"{settings.BACKOFFICE_URL}/login#token={access_token}"

    # Welcome email with the onboarding checklist — best-effort: a delivery
    # failure must not fail the provisioning response.
    email_service = get_email_service()
    sent = await email_service.send_trial_welcome(
        to=email,
        subject=f"Welcome to {settings.PROJECT_NAME} - your trial has started",
        context=TrialWelcomeContext(
            gathering_name=gathering_name,
            backoffice_url=login_url,
            trial_days=TRIAL_DURATION_DAYS,
        ),
        db_session=session,
    )
    if not sent:
        logger.error(f"Failed to send trial welcome email to {email}")

    return tenant, user, popup, access_token
