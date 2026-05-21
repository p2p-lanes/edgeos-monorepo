"""Markdown renderer for /me/access/docs?format=markdown."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.api.access.introspection import RouteDoc
    from app.api.access.schemas import MeAccess


def render_access_docs_markdown(
    me: MeAccess,
    by_scope: dict[str, list[RouteDoc]],
) -> str:
    """Render a Markdown document listing endpoints per scope for the caller.

    Structure:
        # Access for <app_name>

        ## `<scope>`
        - **METHOD** `path` — summary
    """
    lines: list[str] = [f"# Access for {me.app_name}", ""]
    for scope in sorted(by_scope):
        lines.append(f"## `{scope}`")
        routes = by_scope[scope]
        if not routes:
            lines.append("_No routes registered for this scope._")
        else:
            for r in routes:
                lines.append(f"- **{r.method}** `{r.path}` — {r.summary}")
        lines.append("")
    return "\n".join(lines)
