"""Scope-routes registry for /me/access/docs.

Design D-2: static registry populated by a @scope_route decorator and
finalized at app startup by register_scope_routes(application).

Usage — decorate a route handler with @scope_route(scope) BEFORE the FastAPI
decorator applies:

    @router.get("/api-keys", summary="List your API keys")
    @scope_route("portal:api_keys_manage")
    async def list_api_keys(...): ...

Then call register_scope_routes(application) once in app.main after
application.include_router(api_router, ...).
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi import FastAPI

# ---------------------------------------------------------------------------
# RouteDoc dataclass
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RouteDoc:
    method: str
    path: str
    summary: str


# ---------------------------------------------------------------------------
# Registry — populated by register_scope_routes() at startup
# ---------------------------------------------------------------------------

# scope -> list of routes that require that scope
SCOPE_ROUTES_REGISTRY: dict[str, list[RouteDoc]] = {}


# ---------------------------------------------------------------------------
# Decorator
# ---------------------------------------------------------------------------


def scope_route(scope: str) -> Callable:
    """Decorator factory that marks a route handler as scope-protected.

    Attaches ``__scope_routes__`` set to the handler function. At startup,
    ``register_scope_routes`` walks all registered APIRoute instances, reads
    this attribute, and populates SCOPE_ROUTES_REGISTRY.

    Apply AFTER the @router.get/post/... decorator so that FastAPI's route
    object wraps the already-marked function:

        @router.get("/foo", summary="Get foo")
        @scope_route("portal:self_read")
        async def get_foo(...): ...
    """

    def decorator(fn: Callable) -> Callable:
        existing: set[str] = getattr(fn, "__scope_routes__", set())
        fn.__scope_routes__ = existing | {scope}  # type: ignore[attr-defined]
        return fn

    return decorator


# ---------------------------------------------------------------------------
# Startup hook
# ---------------------------------------------------------------------------


def register_scope_routes(app: FastAPI) -> None:
    """Walk all registered APIRoutes and populate SCOPE_ROUTES_REGISTRY.

    Must be called AFTER application.include_router(...) so all routes are
    already registered. Called once in app.main at module level.

    The registry is keyed by scope string; each value is a list of RouteDoc.
    Duplicate (scope, method, path) triples are deduplicated.
    """
    from fastapi.routing import APIRoute

    seen: set[tuple[str, str, str]] = set()

    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        scopes: set[str] = getattr(route.endpoint, "__scope_routes__", set())
        for scope in scopes:
            method = next(iter(route.methods), "GET")
            path = route.path
            summary = route.summary or route.name or path
            key = (scope, method, path)
            if key in seen:
                continue
            seen.add(key)
            SCOPE_ROUTES_REGISTRY.setdefault(scope, []).append(
                RouteDoc(method=method, path=path, summary=summary)
            )
