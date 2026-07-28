from fastapi import APIRouter, Depends, status

from app.api.trial import crud
from app.api.trial.schemas import (
    TrialCodeSentResponse,
    TrialCreate,
    TrialProvisionedResponse,
    TrialVerify,
)
from app.core.config import settings
from app.core.dependencies.users import SessionDep
from app.core.rate_limit import RateLimit

router = APIRouter(prefix="/trials", tags=["trials"])


@router.post(
    "",
    response_model=TrialCodeSentResponse,
    dependencies=[
        Depends(RateLimit(limit=3, window_sec=3600, key_prefix="rl:trials-create"))
    ],
)
async def create_trial(
    request: TrialCreate,
    session: SessionDep,
) -> TrialCodeSentResponse:
    """Start a self-serve trial signup (public, no auth).

    Stores a pending trial (15-min TTL) and emails a 6-digit verification
    code. Rate-limited to 3 requests per hour per IP. Rejects with 409 when
    an active trial (pending or provisioned, non-suspended) already exists
    for the email.
    """
    email, expiration_minutes = await crud.start_trial(
        session=session,
        gathering_name=request.gathering_name,
        email=request.email,
    )

    return TrialCodeSentResponse(
        message="Verification code sent to your email",
        email=email,
        expires_in_minutes=expiration_minutes,
    )


@router.post(
    "/verify",
    response_model=TrialProvisionedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def verify_trial(
    request: TrialVerify,
    session: SessionDep,
) -> TrialProvisionedResponse:
    """Verify the emailed code and provision the trial workspace (public).

    On success creates the tenant (is_trial, 7-day expiry), the first ADMIN
    user, and a draft popup named after the gathering, then returns a user
    JWT (same shape as /auth/user/authenticate) so the visitor lands in the
    backoffice already signed in.
    """
    tenant, _user, popup, access_token = await crud.verify_trial(
        session=session,
        email=request.email,
        code=request.code,
    )

    return TrialProvisionedResponse(
        access_token=access_token,
        tenant_id=tenant.id,
        popup_id=popup.id,
        backoffice_url=settings.BACKOFFICE_URL,
    )
