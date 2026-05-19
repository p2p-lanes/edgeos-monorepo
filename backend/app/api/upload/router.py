"""Upload API router."""

import uuid
from uuid import uuid4

from fastapi import APIRouter, HTTPException

from app.api.upload.schemas import PresignedUrlRequest, PresignedUrlResponse
from app.core.config import settings
from app.core.dependencies.users import CurrentHuman, CurrentUser
from app.services.storage import storage_service

router = APIRouter(prefix="/uploads", tags=["uploads"])

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/gif", "image/webp"}
ALLOWED_VIDEO_TYPES = {"video/mp4"}
ALLOWED_BACKOFFICE_TYPES = ALLOWED_IMAGE_TYPES | ALLOWED_VIDEO_TYPES | {
    "application/pdf"
}
ALLOWED_PORTAL_TYPES = ALLOWED_IMAGE_TYPES


def _build_presigned_url(
    filename: str,
    content_type: str,
    tenant_id: uuid.UUID | str | None,
    allowed_types: set[str],
) -> PresignedUrlResponse:
    if not settings.storage_enabled:
        raise HTTPException(
            status_code=503,
            detail="Storage is not configured",
        )
    if content_type not in allowed_types:
        raise HTTPException(
            status_code=400,
            detail=f"Content type must be one of: {', '.join(sorted(allowed_types))}",
        )

    extension = filename.rsplit(".", 1)[-1].lower() if "." in filename else "bin"
    if not extension.isalnum() or len(extension) > 10:
        extension = "bin"

    key_tenant = str(tenant_id) if tenant_id else "superadmin"
    if content_type == "application/pdf":
        folder = "documents"
    elif content_type.startswith("video/"):
        folder = "videos"
    else:
        folder = "images"
    key = f"{key_tenant}/{folder}/{uuid4()}.{extension}"

    storage = storage_service()
    upload_url = storage.generate_upload_url(
        key=key, content_type=content_type, expires_in=3600
    )
    return PresignedUrlResponse(
        upload_url=upload_url,
        key=key,
        public_url=storage.get_public_url(key),
    )


@router.post("/presigned-url", response_model=PresignedUrlResponse)
async def get_presigned_upload_url(
    request: PresignedUrlRequest,
    current_user: CurrentUser,
) -> PresignedUrlResponse:
    """Generate a presigned URL for direct upload (backoffice staff)."""
    return _build_presigned_url(
        request.filename,
        request.content_type,
        current_user.tenant_id,
        ALLOWED_BACKOFFICE_TYPES,
    )


@router.post("/portal/presigned-url", response_model=PresignedUrlResponse)
async def get_presigned_upload_url_portal(
    request: PresignedUrlRequest,
    current_human: CurrentHuman,
) -> PresignedUrlResponse:
    """Generate a presigned URL for direct upload (portal humans)."""
    return _build_presigned_url(
        request.filename,
        request.content_type,
        current_human.tenant_id,
        ALLOWED_PORTAL_TYPES,
    )
