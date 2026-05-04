"""Per-IP Redis token-bucket rate limiting as a FastAPI dependency factory.

Usage:
    from app.core.rate_limit import RateLimit

    @router.post("/endpoint", dependencies=[Depends(RateLimit(limit=10, window_sec=60, key_prefix="rl:endpoint"))])
    async def handler(...): ...

If Redis is unavailable (get_redis() returns None), the dependency FAILS OPEN:
the request proceeds and a WARNING is logged. This is intentional — rate limiting
is an abuse mitigation, not a security boundary.

429 response shape:
    {"detail": "Too many requests", "retry_after": <seconds>}
    Header: Retry-After: <seconds>
"""

import redis as redis_lib
from fastapi import HTTPException, Request, status
from loguru import logger

from app.core.redis import get_redis


class RateLimitExceeded(HTTPException):
    """HTTPException subclass for rate limit 429 responses.

    Extends HTTPException so FastAPI's default handler catches it,
    but we register a custom handler in app.main to add retry_after
    to the response body.
    """

    def __init__(self, retry_after: int) -> None:
        self.retry_after = retry_after
        super().__init__(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests",
            headers={"Retry-After": str(retry_after)},
        )


def RateLimit(limit: int, window_sec: int, key_prefix: str):
    """FastAPI dependency factory for per-IP token-bucket rate limiting.

    Args:
        limit: Maximum number of requests allowed in the window.
        window_sec: Window duration in seconds.
        key_prefix: Key prefix for Redis (e.g. "rl:checkout-purchase").

    Returns:
        A FastAPI sync dependency function. Register with Depends().
    """

    def dependency(request: Request) -> None:
        """Check rate limit for the current request IP."""
        redis_client = get_redis()

        # Extract IP: leftmost from X-Forwarded-For, fallback to direct host
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            ip = forwarded_for.split(",")[0].strip()
        else:
            ip = request.client.host if request.client else "unknown"

        key = f"{key_prefix}:{ip}"

        if redis_client is None:
            # Fail-open: Redis not configured/available
            logger.warning(
                "RateLimit: Redis unavailable for key prefix '{}' — failing open",
                key_prefix,
            )
            return

        try:
            current = redis_client.get(key)

            if current is None:
                # First request in this window: set counter with expiration
                redis_client.setex(key, window_sec, 1)
                return

            current_count = int(current)  # type: ignore[arg-type]

            if current_count >= limit:
                # At or over limit: get TTL for Retry-After
                ttl = redis_client.ttl(key)
                retry_after = max(1, int(ttl))
                raise RateLimitExceeded(retry_after=retry_after)

            # Increment counter (key already exists with TTL)
            redis_client.incr(key)

        except RateLimitExceeded:
            raise
        except redis_lib.RedisError as exc:
            # Redis error: fail-open
            logger.warning(
                "RateLimit: Redis error for key '{}' — failing open: {}",
                key,
                exc,
            )

    return dependency
