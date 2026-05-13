from fastapi import APIRouter
from loguru import logger

from app.api.auth.crud import (
    authenticate_human,
    authenticate_user,
    login_human,
    login_user,
)
from app.api.auth.schemas import (
    AuthCodeSentResponse,
    HumanAuth,
    HumanVerify,
    UserAuth,
    UserVerify,
)
from app.api.shared.enums import UserRole
from app.core.dependencies.users import SessionDep
from app.core.security import Token, create_access_token

router = APIRouter(prefix="/auth", tags=["auth"])


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
