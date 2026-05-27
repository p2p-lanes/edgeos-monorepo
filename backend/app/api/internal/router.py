"""Internal endpoints for external schedulers (cron).

Guarded by a shared secret (``settings.CRON_SECRET``) rather than user/tenant
auth — these run as cross-tenant system jobs. Hidden from the OpenAPI schema.
"""

import secrets

from fastapi import APIRouter, Header, HTTPException, status

from app.core.config import settings
from app.core.dependencies.users import SessionDep
from app.services.checkin_pass_dispatch import dispatch_checkin_passes

router = APIRouter(prefix="/internal", tags=["internal"])


def _verify_cron_secret(provided: str | None) -> None:
    """Reject unless a valid X-Cron-Secret was supplied (constant-time compare)."""
    if not settings.CRON_SECRET:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cron endpoints are disabled (CRON_SECRET not configured)",
        )
    if not provided or not secrets.compare_digest(provided, settings.CRON_SECRET):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing cron secret",
        )


@router.post("/cron/checkin-passes", include_in_schema=False)
async def run_checkin_pass_dispatch(
    db: SessionDep,
    x_cron_secret: str | None = Header(default=None, alias="X-Cron-Secret"),
) -> dict:
    """Send scheduled check-in pass emails. Called hourly by an external cron."""
    _verify_cron_secret(x_cron_secret)
    return await dispatch_checkin_passes(db)
