"""Scope-routes registry for /third-party-apps/docs and /openapi.json.

The registry maps each HumanScope to the routes that require it. It is
populated at startup by walking every APIRoute's dependency tree and
collecting `.scope` attributes set by `require_human_scope` (see
`app.core.dependencies.users`).

There is no per-route decorator: the scope is declared exactly once at the
route definition via:

    @router.get(
        "/foo",
        summary="Get foo",
        dependencies=[needs("portal:profile:read")],
    )
    async def get_foo(...): ...

The walker handles nested dependencies (Depends within Depends), so a scope
attached deep in the dependency tree still surfaces in the registry.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from fastapi import FastAPI


@dataclass(frozen=True)
class RouteDoc:
    method: str
    path: str
    summary: str


# scope -> list of routes that require that scope
SCOPE_ROUTES_REGISTRY: dict[str, list[RouteDoc]] = {}


def _collect_scopes(dependant: Any) -> set[str]:
    """Walk a FastAPI Dependant tree and return every `.scope` attribute
    attached to a dependency's callable (set by `require_human_scope`)."""
    scopes: set[str] = set()
    call = getattr(dependant, "call", None)
    if call is not None:
        scope = getattr(call, "scope", None)
        if isinstance(scope, str):
            scopes.add(scope)
    for sub in getattr(dependant, "dependencies", []) or []:
        scopes |= _collect_scopes(sub)
    return scopes


def register_scope_routes(app: FastAPI) -> None:
    """Walk all registered APIRoutes and populate SCOPE_ROUTES_REGISTRY.

    Must be called AFTER `application.include_router(...)` so every route is
    visible. Idempotent — re-running clears and rebuilds the registry.
    """
    from fastapi.routing import APIRoute

    SCOPE_ROUTES_REGISTRY.clear()
    seen: set[tuple[str, str, str]] = set()

    for route in app.routes:
        if not isinstance(route, APIRoute):
            continue
        scopes = _collect_scopes(route.dependant)
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
