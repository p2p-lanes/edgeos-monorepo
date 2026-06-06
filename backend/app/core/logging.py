"""Centralized logging configuration and per-request context.

Goal: make a single real request followable end to end in the logs, and make a
customer report locatable without asking the user for any id.

- ``configure_logging`` reconfigures loguru so every line carries a
  ``request_id`` and the authenticated ``principal``.
- ``RequestContextMiddleware`` assigns or propagates an ``X-Request-ID`` per
  request, derives the principal from the bearer token, binds both into the
  loguru context (so every log emitted while handling that request shares them),
  and emits one structured line per request with method, path, status, and
  duration. Health checks are skipped to keep the signal high.

The ``principal`` (``<token_type>:<sub>``, e.g. ``human:<uuid>``) is what makes a
cold report findable: map the customer's email to their human_id, then grep that
id. The ``request_id`` is for correlating all lines of one request once found
(and for support flows where it can be surfaced to the user).

Request and response bodies are intentionally NOT logged: these routes carry
PII, payment data, and auth tokens. The error *detail* returned to the client
is logged by the HTTPException handler in ``app.main`` instead, which is safe
because it is our own message rather than user-submitted content.
"""

import sys
import time
import uuid
from contextvars import ContextVar

from loguru import logger
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.core.config import settings

# Per-request id, mirrored from the loguru context so non-logging code (e.g. the
# audit log) can correlate a persisted row with the stdout request line.
_request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)


def get_request_id() -> str | None:
    """Return the current request's id, or ``None`` outside a request."""
    return _request_id_var.get()


_LOG_FORMAT = (
    "{time:YYYY-MM-DD HH:mm:ss.SSS} | "
    "{level: <8} | "
    "{extra[request_id]} | "
    "{extra[principal]} | "
    "{name}:{function}:{line} - "
    "{message}"
)


def _principal_from_headers(headers: dict[bytes, bytes]) -> str:
    """Best-effort identity for log correlation, read from the bearer token.

    Returns ``"<token_type>:<sub>"`` (e.g. ``human:<uuid>``) so a customer
    report can be located by mapping their email to a human_id and grepping that
    id. Returns ``-`` for anonymous requests, api-key auth, or tokens that fail
    to decode. This NEVER enforces auth; real auth still runs in the route
    dependencies. Decoding is verified (signature + exp) and cheap.
    """
    auth = headers.get(b"authorization", b"").decode(errors="ignore")
    if not auth.lower().startswith("bearer "):
        return "-"
    token = auth[7:].strip()
    if not token:
        return "-"
    try:
        from app.core.security import decode_access_token

        payload = decode_access_token(token)
    except Exception:
        # Expired/invalid/non-JWT (e.g. api key): nothing to bind for logging.
        return "-"
    if not payload.sub:
        return "-"
    return f"{payload.token_type or 'token'}:{payload.sub}"


def configure_logging() -> None:
    """Reconfigure loguru: single stdout sink with a request_id on every line.

    Idempotent — safe to call once at import time. ``extra["request_id"]``
    defaults to ``-`` so lines emitted outside a request (startup, background
    jobs) still render with the same format.
    """
    logger.remove()
    logger.configure(extra={"request_id": "-", "principal": "-"})
    logger.add(
        sys.stdout,
        format=_LOG_FORMAT,
        level=settings.LOG_LEVEL,
        colorize=False,
        backtrace=False,
        diagnose=False,
    )


class RequestContextMiddleware:
    """Pure-ASGI middleware: per-request id plus one structured access line.

    Implemented as pure ASGI (not ``BaseHTTPMiddleware``) so the contextvar set
    by ``logger.contextualize`` propagates into the route handler and every log
    it emits, letting one ``request_id`` tie the whole request together.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        if path == "/health-check":
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers") or [])
        inbound = headers.get(b"x-request-id")
        request_id = inbound.decode() if inbound else uuid.uuid4().hex[:12]

        method = scope.get("method", "-")
        client = scope.get("client")
        client_ip = client[0] if client else "-"
        principal = _principal_from_headers(headers)

        status_code = {"code": 0}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_code["code"] = message["status"]
                # Echo the id back so support can correlate a user report.
                message.setdefault("headers", [])
                message["headers"].append((b"x-request-id", request_id.encode()))
            await send(message)

        start = time.perf_counter()
        token = _request_id_var.set(request_id)
        with logger.contextualize(request_id=request_id, principal=principal):
            try:
                await self.app(scope, receive, send_wrapper)
            finally:
                _request_id_var.reset(token)
                duration_ms = round((time.perf_counter() - start) * 1000, 1)
                code = status_code["code"]
                level = "ERROR" if code >= 500 else "WARNING" if code >= 400 else "INFO"
                logger.log(
                    level,
                    "{} {} -> {} ({}ms) ip={}",
                    method,
                    path,
                    code,
                    duration_ms,
                    client_ip,
                )
