"""Accepted-application emails must deep-link the CTA to the popup's passes page.

Regression test for the "Purchase Passes" button pointing at the bare tenant
base URL (which redirects to the first/default popup) instead of
``/portal/{popup.slug}/passes``.
"""

import uuid
from types import SimpleNamespace

from app.api.popup.crud import popups_crud
from app.services.email.service import EmailService, _enrich_with_popup_data


class _FakeDBSession:
    """Minimal stand-in for a Session: only ``.get`` is exercised."""

    def __init__(self, tenant):
        self._tenant = tenant

    def get(self, _model, _pk):
        return self._tenant


def _make_popup(slug: str):
    return SimpleNamespace(
        name="Edge Summit",
        slug=slug,
        tenant_id=uuid.uuid4(),
        image_url=None,
        icon_url=None,
        web_url=None,
        blog_url=None,
        twitter_url=None,
        start_date=None,
        end_date=None,
    )


def _make_tenant(slug="acme", custom_domain=None, custom_domain_active=False):
    return SimpleNamespace(
        slug=slug,
        custom_domain=custom_domain,
        custom_domain_active=custom_domain_active,
    )


def test_enrich_adds_popup_specific_passes_url(monkeypatch):
    popup = _make_popup("edge-summit")
    monkeypatch.setattr(popups_crud, "get", lambda *a, **k: popup)

    enriched = _enrich_with_popup_data(
        {}, popup_id=uuid.uuid4(), db_session=_FakeDBSession(_make_tenant())
    )

    assert "portal_url" in enriched
    assert "passes_url" in enriched
    assert (
        enriched["passes_url"] == f"{enriched['portal_url']}/portal/edge-summit/passes"
    )
    assert enriched["passes_url"].endswith("/portal/edge-summit/passes")


def test_accepted_email_button_deep_links_to_passes_page(monkeypatch):
    popup = _make_popup("edge-summit")
    monkeypatch.setattr(popups_crud, "get", lambda *a, **k: popup)

    enriched = _enrich_with_popup_data(
        {"first_name": "Ada", "last_name": "Lovelace", "popup_name": "Edge Summit"},
        popup_id=uuid.uuid4(),
        db_session=_FakeDBSession(_make_tenant()),
    )

    html = EmailService().render_template("application/accepted.html", enriched)

    passes_url = enriched["passes_url"]
    portal_url = enriched["portal_url"]

    # The CTA href is the popup-specific passes deep link...
    assert f'href="{passes_url}"' in html
    assert passes_url.endswith("/portal/edge-summit/passes")
    # ...not the bare tenant base URL.
    assert f'href="{portal_url}"' not in html


def test_accepted_email_passes_url_respects_active_custom_domain(monkeypatch):
    popup = _make_popup("edge-summit")
    monkeypatch.setattr(popups_crud, "get", lambda *a, **k: popup)

    tenant = _make_tenant(custom_domain="events.acme.com", custom_domain_active=True)
    enriched = _enrich_with_popup_data(
        {}, popup_id=uuid.uuid4(), db_session=_FakeDBSession(tenant)
    )

    assert enriched["passes_url"] == "https://events.acme.com/portal/edge-summit/passes"
