"""Startup-invariant test for SCOPE_ROUTES_REGISTRY.

Design D-2: every route handler decorated with @scope_route(scope) MUST appear
in SCOPE_ROUTES_REGISTRY[scope] after register_scope_routes(application) runs.

This test verifies the invariant holds after application startup (the registry
is populated lazily or at startup before the first request).
"""

from __future__ import annotations

from fastapi.routing import APIRoute

from app.main import application


class TestScopeRoutesRegistryInvariant:
    """Invariant: every @scope_route-decorated route is in the registry."""

    def test_registry_is_populated(self) -> None:
        """After app startup, SCOPE_ROUTES_REGISTRY must have at least one entry."""
        from app.api.access.introspection import SCOPE_ROUTES_REGISTRY

        assert len(SCOPE_ROUTES_REGISTRY) > 0, (
            "SCOPE_ROUTES_REGISTRY is empty — did register_scope_routes run?"
        )

    def test_all_scope_route_decorated_handlers_are_registered(self) -> None:
        """Every route endpoint with __scope_routes__ appears in the registry."""
        from app.api.access.introspection import SCOPE_ROUTES_REGISTRY

        missing: list[tuple[str, str, str]] = []
        for route in application.routes:
            if not isinstance(route, APIRoute):
                continue
            scopes = getattr(route.endpoint, "__scope_routes__", set())
            for scope in scopes:
                registered_paths = {
                    (r.method, r.path) for r in SCOPE_ROUTES_REGISTRY.get(scope, [])
                }
                method = next(iter(route.methods), "GET")
                if (method, route.path) not in registered_paths:
                    missing.append((scope, method, route.path))

        assert not missing, (
            "Routes decorated with @scope_route are missing from the registry:\n"
            + "\n".join(f"  scope={s} method={m} path={p}" for s, m, p in missing)
        )

    def test_registry_entries_have_required_fields(self) -> None:
        """Each RouteDoc has method, path, and summary."""
        from app.api.access.introspection import SCOPE_ROUTES_REGISTRY, RouteDoc

        for scope, routes in SCOPE_ROUTES_REGISTRY.items():
            for r in routes:
                assert isinstance(r, RouteDoc), f"Expected RouteDoc, got {type(r)}"
                assert r.method, f"RouteDoc for {scope} has empty method"
                assert r.path, f"RouteDoc for {scope} has empty path"
                assert r.summary, f"RouteDoc for {scope} has empty summary"

    def test_known_scope_portal_api_keys_manage_has_routes(self) -> None:
        """portal:api_keys_manage scope must have at least one registered route."""
        from app.api.access.introspection import SCOPE_ROUTES_REGISTRY

        assert "portal:api_keys_manage" in SCOPE_ROUTES_REGISTRY, (
            "portal:api_keys_manage not in registry — "
            "check @scope_route decoration on api_key router"
        )
        assert len(SCOPE_ROUTES_REGISTRY["portal:api_keys_manage"]) >= 1
