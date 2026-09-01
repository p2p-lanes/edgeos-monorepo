from fastapi import APIRouter, status
from fastapi.responses import Response
from loguru import logger

from app.api.custom_export.schemas import (
    CustomExportSpec,
    ExportCatalogPublic,
    ExportDownloadRequest,
    ExportPreview,
)
from app.api.custom_export.service import (
    export_catalog,
    generate_export,
    preview_export,
)
from app.core.dependencies.users import CurrentOperator, TenantSession

router = APIRouter(prefix="/custom-exports", tags=["custom-exports"])


@router.get("/catalog", response_model=ExportCatalogPublic)
async def get_export_catalog(
    _: CurrentOperator,
) -> ExportCatalogPublic:
    """List the server-owned datasets and fields available to custom exports."""
    return export_catalog()


@router.post("/preview", response_model=ExportPreview)
async def preview_custom_export(
    spec: CustomExportSpec,
    db: TenantSession,
    _: CurrentOperator,
) -> ExportPreview:
    """Validate an export plan and count its exact result without creating a file."""
    return preview_export(db, spec)


@router.post(
    "/download",
    response_class=Response,
    responses={
        status.HTTP_200_OK: {
            "description": "Generated custom export",
            "content": {
                "text/csv": {"schema": {"type": "string"}},
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
                    "schema": {"type": "string", "format": "binary"}
                },
            },
        }
    },
)
async def download_custom_export(
    request: ExportDownloadRequest,
    db: TenantSession,
    current_user: CurrentOperator,
) -> Response:
    """Generate the exact previously previewed CSV or XLSX export."""
    content, media_type, filename = generate_export(
        db,
        request.spec,
        request.fingerprint,
    )
    logger.info(
        "custom_export_download user_id={} dataset={} format={} bytes={}",
        current_user.id,
        request.spec.dataset,
        request.spec.format.value,
        len(content),
    )
    return Response(
        content=content,
        media_type=media_type,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
        },
    )
