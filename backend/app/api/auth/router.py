import secrets

from fastapi import APIRouter, Header, HTTPException, status
from loguru import logger
from sqlmodel import select

from app.api.api_key.crud import hash_key as hash_api_key
from app.api.auth.crud import (
    authenticate_human,
    authenticate_user,
    login_existing_human,
    login_human,
    login_user,
)
from app.api.auth.schemas import (
    AuthCodeSentResponse,
    HumanAuth,
    HumanVerify,
    ThirdPartyHumanLogin,
    ThirdPartyHumanVerify,
    UserAuth,
    UserVerify,
)
from app.api.shared.enums import UserRole
from app.api.tenant.models import Tenants
from app.core.dependencies.users import SessionDep
from app.core.security import THIRD_PARTY_TOKEN_SCOPES, Token, create_access_token

router = APIRouter(prefix="/auth", tags=["auth"])


def _validate_third_party_key(
    session,
    raw_key: str,
) -> Tenants:
    """Resolve the tenant from the third-party API key alone.

    Hashes the raw key, looks up the tenant by the (partially unique) hash
    column. All failure branches collapse to a single 401 — callers cannot
    distinguish unknown key, wrong key, or disabled tenant from each other.
    """
    key_hash = hash_api_key(raw_key)
    tenant = session.exec(
        select(Tenants).where(Tenants.third_party_api_key_hash == key_hash)
    ).first()

    if tenant is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid third-party credentials",
        )

    # Defensive constant-time compare — the index lookup is already a strict
    # equality match, but the explicit check makes the timing path uniform.
    if not secrets.compare_digest(key_hash, tenant.third_party_api_key_hash or ""):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid third-party credentials",
        )

    return tenant


@router.post("/user/login", response_model=AuthCodeSentResponse)
async def user_login(
    request: UserAuth,
    session: SessionDep,
) -> AuthCodeSentResponse:
    """
    Login a user and send a 6-digit code to their email.
    CHECK_IN_CONTROLLER is rejected pre-OTP — use /auth/scanner/login instead.
    """
    email, expiration_minutes = await login_user(
        session=session,
        email=request.email,
        allowed_roles={
            UserRole.SUPERADMIN,
            UserRole.ADMIN,
            UserRole.OPERATOR,
            UserRole.VIEWER,
        },
    )

    return AuthCodeSentResponse(
        message="Authentication code sent to your email",
        email=email,
        expires_in_minutes=expiration_minutes,
    )


@router.post("/user/authenticate", response_model=Token)
async def user_authenticate(
    request: UserVerify,
    session: SessionDep,
) -> Token:
    """
    Authenticate a user and return a JWT token.
    CHECK_IN_CONTROLLER is rejected — use /auth/scanner/authenticate instead.
    """
    user = await authenticate_user(
        session=session,
        email=request.email,
        code=request.code,
        allowed_roles={
            UserRole.SUPERADMIN,
            UserRole.ADMIN,
            UserRole.OPERATOR,
            UserRole.VIEWER,
        },
    )

    access_token = create_access_token(subject=user.id, token_type="user")
    logger.info(f"User authenticated: {user.email}")

    return Token(access_token=access_token)


@router.post("/scanner/login", response_model=AuthCodeSentResponse)
async def scanner_login(
    request: UserAuth,
    session: SessionDep,
) -> AuthCodeSentResponse:
    """
    Initiate scanner login. Accepts CHECK_IN_CONTROLLER, OPERATOR, ADMIN, and SUPERADMIN.
    VIEWER is rejected pre-OTP — must not receive a code they can't redeem.
    """
    email, expiration_minutes = await login_user(
        session=session,
        email=request.email,
        allowed_roles={
            UserRole.SUPERADMIN,
            UserRole.ADMIN,
            UserRole.OPERATOR,
            UserRole.CHECK_IN_CONTROLLER,
        },
    )

    return AuthCodeSentResponse(
        message="Authentication code sent to your email",
        email=email,
        expires_in_minutes=expiration_minutes,
    )


@router.post("/scanner/authenticate", response_model=Token)
async def scanner_authenticate(
    request: UserVerify,
    session: SessionDep,
) -> Token:
    """
    Authenticate a scanner operator and return a JWT token.
    Only SUPERADMIN, ADMIN, OPERATOR, and CHECK_IN_CONTROLLER are accepted.
    VIEWER is rejected with 403.
    """
    user = await authenticate_user(
        session=session,
        email=request.email,
        code=request.code,
        allowed_roles={
            UserRole.SUPERADMIN,
            UserRole.ADMIN,
            UserRole.OPERATOR,
            UserRole.CHECK_IN_CONTROLLER,
        },
    )

    access_token = create_access_token(subject=user.id, token_type="user")
    logger.info(f"Scanner operator authenticated: {user.email}")

    return Token(access_token=access_token)


@router.post("/human/login", response_model=AuthCodeSentResponse)
async def human_login(
    request: HumanAuth,
    session: SessionDep,
) -> AuthCodeSentResponse:
    """
    Initiate authentication for a human.
    Creates a pending human record and sends a 6-digit code to their email.
    """
    email, expiration_minutes = await login_human(
        session=session,
        data=request,
    )

    return AuthCodeSentResponse(
        message="Verification code sent to your email",
        email=email,
        expires_in_minutes=expiration_minutes,
    )


@router.post("/human/authenticate", response_model=Token)
async def human_authenticate(
    request: HumanVerify,
    session: SessionDep,
) -> Token:
    """
    Authenticate a human and return a JWT token.
    """
    human = await authenticate_human(
        session=session,
        email=request.email,
        tenant_id=request.tenant_id,
        code=request.code,
    )

    access_token = create_access_token(subject=human.id, token_type="human")
    logger.info(f"Human authenticated: {human.email}")

    return Token(access_token=access_token)


@router.post("/human/third-party/login", response_model=AuthCodeSentResponse)
async def third_party_human_login(
    request: ThirdPartyHumanLogin,
    session: SessionDep,
    x_third_party_api_key: str = Header(..., alias="X-Third-Party-Api-Key"),
) -> AuthCodeSentResponse:
    """Initiate OTP login for an EXISTING human via a third-party integration.

    The caller supplies only a valid third-party API key in
    X-Third-Party-Api-Key; the tenant is resolved server-side from the key.
    Unlike the portal login endpoint, this surface NEVER creates a pending
    human row — the partner is expected to have onboarded the user
    out-of-band.

    On any validation failure (wrong key, unknown email) the response is 401
    to prevent existence leakage.
    """
    tenant = _validate_third_party_key(session, x_third_party_api_key)

    email, expiration_minutes = await login_existing_human(
        session=session,
        tenant_id=tenant.id,
        email=request.email,
    )

    logger.info(f"Third-party OTP sent to human: {email}")
    return AuthCodeSentResponse(
        message="Mail sent successfully",
        email=email,
        expires_in_minutes=expiration_minutes,
    )


@router.post("/human/third-party/authenticate", response_model=Token)
async def third_party_human_authenticate(
    request: ThirdPartyHumanVerify,
    session: SessionDep,
    x_third_party_api_key: str = Header(..., alias="X-Third-Party-Api-Key"),
) -> Token:
    """Verify OTP and mint a third-party JWT for an existing human.

    The tenant is resolved server-side from the third-party API key alone.
    Returns a JWT with issued_via=third_party and scopes=THIRD_PARTY_TOKEN_SCOPES.
    The JWT grants portal:self_read, portal:directory_read, and
    portal:api_keys_manage on the portal surface; it does NOT grant admin access.
    """
    tenant = _validate_third_party_key(session, x_third_party_api_key)

    human = await authenticate_human(
        session=session,
        email=request.email,
        tenant_id=tenant.id,
        code=request.code,
    )

    access_token = create_access_token(
        subject=human.id,
        token_type="human",
        scopes=list(THIRD_PARTY_TOKEN_SCOPES),
        issued_via="third_party",
    )
    logger.info(f"Third-party human authenticated: {human.email}")

    return Token(access_token=access_token)
