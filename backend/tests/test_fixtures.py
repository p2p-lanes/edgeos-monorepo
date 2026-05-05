"""Fixture coexistence test (REQ-G.1).

Verifies that popup_tenant_a_summer_fest and popup_tenant_b_summer_fest
can coexist in the same database — which only works after migration 0043
replaces the global unique on popups.slug with the composite
unique(tenant_id, slug).
"""

from sqlmodel import Session


def test_shared_slug_fixtures_coexist(
    db: Session,
    popup_tenant_a_summer_fest,
    popup_tenant_b_summer_fest,
) -> None:
    """Both same-slug popups must exist with distinct tenant_ids (REQ-G.1)."""
    db.refresh(popup_tenant_a_summer_fest)
    db.refresh(popup_tenant_b_summer_fest)

    assert popup_tenant_a_summer_fest.id is not None
    assert popup_tenant_b_summer_fest.id is not None

    assert popup_tenant_a_summer_fest.slug == "summer-fest"
    assert popup_tenant_b_summer_fest.slug == "summer-fest"

    assert popup_tenant_a_summer_fest.tenant_id != popup_tenant_b_summer_fest.tenant_id, (
        "Both popups have slug 'summer-fest' but must belong to different tenants"
    )
