from fastapi import APIRouter
from loguru import logger

from app.api.auth.crud import (
    authenticate_human,
    authenticate_human_for_checkout,
    authenticate_user,
    login_human,
    login_user,
)
from app.api.auth.schemas import (
    AuthCodeSentResponse,
    HumanAuth,
    HumanCheckoutAuth,
    HumanVerify,
    UserAuth,
    UserVerify,
)
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
    """
    email, expiration_minutes = await login_user(
        session=session,
        email=request.email,
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
    """
    user = await authenticate_user(
        session=session,
        email=request.email,
        code=request.code,
    )

    access_token = create_access_token(subject=user.id, token_type="user")
    logger.info(f"User authenticated: {user.email}")

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


@router.post("/human/checkout-authenticate", response_model=Token)
async def human_checkout_authenticate(
    request: HumanCheckoutAuth,
    session: SessionDep,
) -> Token:
    """Authenticate a human for popup checkout when OTP is disabled.

    Issues a narrowly scoped ``human_checkout`` token bound to ``popup_id``.
    The token only opens the checkout allowlist — the rest of the portal
    still requires a full OTP-validated ``human`` token.
    """
    human = authenticate_human_for_checkout(
        session=session,
        popup_id=request.popup_id,
        email=request.normalized_email,
    )

    access_token = create_access_token(
        subject=human.id,
        token_type="human_checkout",
        popup_id=request.popup_id,
    )
    logger.info(f"Human checkout-authenticated without OTP: {human.email}")

    return Token(access_token=access_token)
