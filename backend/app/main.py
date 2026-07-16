import json

import sentry_sdk
from fastapi import FastAPI, Request, status
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from loguru import logger
from pydantic import ValidationError
from sentry_sdk.integrations.loguru import LoggingLevels, LoguruIntegration
from sqlalchemy.exc import IntegrityError, ProgrammingError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware

import app.models  # noqa: F401 - Register all models with SQLAlchemy
from app.api.router import api_router
from app.core.config import Environment, settings
from app.core.logging import RequestContextMiddleware, configure_logging
from app.core.rate_limit import RateLimitExceeded

configure_logging()


def custom_generate_unique_id(route: APIRoute) -> str:
    return f"{route.tags[0]}-{route.name}"


if settings.SENTRY_DSN and settings.ENVIRONMENT == Environment.PRODUCTION:
    sentry_sdk.init(
        dsn=str(settings.SENTRY_DSN),
        environment=settings.ENVIRONMENT.value,
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        enable_logs=True,
        send_default_pii=False,
        integrations=[
            LoguruIntegration(
                sentry_logs_level=LoggingLevels.INFO.value,
                level=LoggingLevels.INFO.value,
                event_level=LoggingLevels.ERROR.value,
            ),
        ],
    )

application = FastAPI(
    title=settings.PROJECT_NAME,
    generate_unique_id_function=custom_generate_unique_id,
)


@application.exception_handler(RateLimitExceeded)
def handle_rate_limit_exceeded(_: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests", "retry_after": exc.retry_after},
        headers={"Retry-After": str(exc.retry_after)},
    )


@application.exception_handler(ValidationError)
def pydantic_validation_error(_: Request, exc: ValidationError) -> JSONResponse:
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": json.loads(exc.json())},
    )


@application.exception_handler(ProgrammingError)
def handle_rls_violation(_: Request, exc: ProgrammingError) -> JSONResponse:
    error_msg = str(exc.orig) if exc.orig else str(exc)
    if (
        "row-level security" in error_msg.lower()
        or "insufficient_privilege" in error_msg.lower()
    ):
        logger.warning(f"RLS policy violation: {error_msg}")
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"detail": "Access denied by security policy"},
        )
    raise exc


@application.exception_handler(IntegrityError)
def handle_integrity_error(_: Request, exc: IntegrityError) -> JSONResponse:
    error_msg = str(exc.orig) if exc.orig else str(exc)
    if (
        "row-level security" in error_msg.lower()
        or "insufficient_privilege" in error_msg.lower()
    ):
        logger.warning(f"RLS policy violation: {error_msg}")
        return JSONResponse(
            status_code=status.HTTP_403_FORBIDDEN,
            content={"detail": "Access denied by security policy"},
        )
    pgcode = getattr(exc.orig, "pgcode", None)
    # Unique constraint violation (23505)
    if pgcode == "23505":
        logger.warning(f"Unique constraint violation: {error_msg}")
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": "A record with this data already exists"},
        )
    # Foreign key violation (23503) — referenced record doesn't exist
    if pgcode == "23503":
        logger.warning(f"Foreign key violation: {error_msg}")
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={"detail": "Referenced record not found"},
        )
    # Check constraint violation (23514) — invalid field value
    if pgcode == "23514":
        logger.warning(f"Check constraint violation: {error_msg}")
        return JSONResponse(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            content={"detail": "Invalid field value"},
        )
    logger.error(f"Integrity error: {error_msg}")
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"detail": "Data integrity error"},
    )


@application.exception_handler(StarletteHTTPException)
def handle_http_exception(
    request: Request, exc: StarletteHTTPException
) -> JSONResponse:
    """Log the detail returned to the client for every raised HTTPException.

    Without this, a raised ``HTTPException`` (e.g. 403 "Application must be
    accepted before purchasing products") leaves only a bare status code in the
    access log, so a real user report cannot be traced. 4xx are logged at
    WARNING, 5xx at ERROR. The response shape matches Starlette's default
    handler so clients see no change.
    """
    log = logger.warning if exc.status_code < 500 else logger.error
    log(
        "{} {} -> {}: {}",
        request.method,
        request.url.path,
        exc.status_code,
        exc.detail,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content={"detail": exc.detail},
        headers=getattr(exc, "headers", None),
    )


application.add_middleware(
    CORSMiddleware,  # type: ignore[arg-type]
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Tenant-Id", "Accept-Language"],
)

# Compress responses for clients that advertise gzip support. Event/calendar
# payloads are large and highly repetitive JSON/ICS — e.g. a popup's public
# .ics feed measured ~310 KB uncompressed, ~100 KB gzipped (~68% smaller) — and
# the API previously sent everything uncompressed, so transfer time dominated
# page load on slower connections. ``minimum_size`` skips tiny responses
# (health checks, CORS preflights, error bodies) where compression isn't worth
# the overhead; ``compresslevel=6`` is the usual ratio/CPU sweet spot (vs
# Starlette's default 9). Starlette adds ``Vary: Accept-Encoding``, rewrites
# Content-Length, and skips responses that already carry ``Content-Encoding``
# or are Server-Sent Events (``text/event-stream``). Note: it does not skip by
# content type otherwise, so already-compressed binaries (e.g. the invoice PDF
# download) get re-gzipped — wasteful but harmless, and those endpoints are
# rare. Added before RequestContextMiddleware so that middleware stays outermost.
application.add_middleware(
    GZipMiddleware,  # type: ignore[arg-type]
    minimum_size=1000,
    compresslevel=6,
)

# Outermost middleware: assigns a request_id, binds it to all logs in the
# request, and emits one structured access line per request.
application.add_middleware(RequestContextMiddleware)  # type: ignore[arg-type]


@application.get("/health-check", tags=["utils"], include_in_schema=False)
async def health_check():
    from sqlmodel import Session, text

    from app.core.db import engine

    try:
        with Session(engine) as session:
            session.exec(text("SELECT 1"))
        return {"status": "healthy"}
    except Exception:
        logger.error("Health check failed: database unreachable")
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "unhealthy", "detail": "Database unreachable"},
        )


application.include_router(api_router, prefix=settings.API_V1_STR)

# Populate the scope-routes registry AFTER all routes are registered.
# This must run at module import time (not inside a startup event) so that
# the registry is available for the first request.
from app.api.access.introspection import register_scope_routes  # noqa: E402

register_scope_routes(application)
