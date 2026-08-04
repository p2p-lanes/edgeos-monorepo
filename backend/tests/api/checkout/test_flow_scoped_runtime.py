"""Tasks 9.2/9.5/9.8 — flow-aware GET /checkout/{slug}/runtime and
GET /checkout/{slug}/{flow_slug}/runtime.

Design: sdd/sales-flows D6 URL scheme, the Flow-Resolution Contract, and the
Threat Matrix's "URL segment resolution" / "Cross-tenant / cross-popup flow
reference" rows. Also closes two disclosed slice-8 gaps for this endpoint:
- risk-001: buyer_form fields must come from the tier-filtered
  `find_for_flow` list, never the unfiltered `FormSections.form_fields` ORM
  relationship (which ignores `sales_flow_id` entirely).
- res-001: the runtime path never applied translation overlays to
  buyer_form/form_schema, unlike `form_field/router.py`'s own portal schema
  endpoint — this closes that mismatch.

TDD: RED -> GREEN.
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.form_field.models import FormFields
from app.api.form_section.models import FormSections
from app.api.popup.models import Popups
from app.api.sales_flow.crud import sales_flows_crud
from app.api.sales_flow.models import SalesFlows
from app.api.shared.enums import SaleType
from app.api.tenant.models import Tenants
from app.api.ticketing_step.models import TicketingSteps


def _make_direct_popup(db: Session, tenant: Tenants) -> Popups:
    slug = f"flowrt-{uuid.uuid4().hex[:8]}"
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Flow Runtime Popup {slug}",
        slug=slug,
        sale_type=SaleType.direct.value,
        status="active",
    )
    db.add(popup)
    db.flush()
    sales_flows_crud.provision_default_flow(
        db, popup_id=popup.id, tenant_id=tenant.id, sale_type=SaleType.direct.value
    )
    db.flush()
    return popup


def _make_flow(
    db: Session,
    popup: Popups,
    *,
    slug: str,
    visibility: str = "portal_listed",
    type: str = "direct",  # noqa: A002
) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        slug=slug,
        name=f"Flow {slug}",
        visibility=visibility,
        type=type,
    )
    db.add(flow)
    db.flush()
    return flow


def _make_ticketing_step(
    db: Session,
    popup: Popups,
    *,
    title: str,
    sales_flow_id: uuid.UUID | None = None,
    order: int = 0,
) -> TicketingSteps:
    step = TicketingSteps(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=sales_flow_id,
        step_type="tickets",
        title=title,
        order=order,
        is_enabled=True,
    )
    db.add(step)
    db.flush()
    return step


def _make_section(
    db: Session,
    popup: Popups,
    *,
    label: str,
    sales_flow_id: uuid.UUID | None = None,
    order: int = 0,
) -> FormSections:
    section = FormSections(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=sales_flow_id,
        label=label,
        order=order,
    )
    db.add(section)
    db.flush()
    return section


def _make_field(
    db: Session,
    popup: Popups,
    section: FormSections,
    *,
    name: str,
    label: str,
    sales_flow_id: uuid.UUID | None = None,
    position: int = 0,
) -> FormFields:
    field = FormFields(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        sales_flow_id=sales_flow_id,
        section_id=section.id,
        name=f"{name}_{uuid.uuid4().hex[:6]}",
        label=label,
        field_type="text",
        position=position,
    )
    db.add(field)
    db.flush()
    return field


class TestFlowSlugRouting:
    def test_named_flow_slug_resolves_that_flow(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_direct_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug="vip")
        _make_ticketing_step(db, popup, title="Default Step")
        _make_ticketing_step(db, popup, title="VIP Step", sales_flow_id=flow.id)
        db.commit()

        response = client.get(
            f"/api/v1/checkout/{popup.slug}/{flow.slug}/runtime",
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 200, response.text
        titles = [s["title"] for s in response.json()["ticketing_steps"]]
        assert titles == ["VIP Step"]

    def test_omitted_flow_slug_resolves_default_flow(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_direct_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug="vip")
        _make_ticketing_step(db, popup, title="Shared Step")
        _make_ticketing_step(db, popup, title="VIP Step", sales_flow_id=flow.id)
        db.commit()

        response = client.get(
            f"/api/v1/checkout/{popup.slug}/runtime",
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 200, response.text
        titles = [s["title"] for s in response.json()["ticketing_steps"]]
        assert titles == ["Shared Step"]

    def test_unknown_flow_slug_returns_404_not_200(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Threat matrix: unknown slug never silently falls back to the
        default flow — a typo must never resolve to the wrong flow."""
        popup = _make_direct_popup(db, tenant_a)
        db.commit()

        response = client.get(
            f"/api/v1/checkout/{popup.slug}/does-not-exist/runtime",
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 404, response.text

    def test_direct_url_only_flow_reachable_by_slug(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Threat matrix: `direct_url_only` hides from listings but never
        blocks direct URL access."""
        popup = _make_direct_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug="unlisted", visibility="direct_url_only")
        db.commit()

        response = client.get(
            f"/api/v1/checkout/{popup.slug}/{flow.slug}/runtime",
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 200, response.text

    def test_flow_slug_from_another_popup_returns_404(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        """Threat matrix: cross-popup flow reference is blocked."""
        popup_a = _make_direct_popup(db, tenant_a)
        popup_b = _make_direct_popup(db, tenant_a)
        other_flow = _make_flow(db, popup_b, slug="only-on-b")
        db.commit()

        response = client.get(
            f"/api/v1/checkout/{popup_a.slug}/{other_flow.slug}/runtime",
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 404, response.text

    def test_application_type_flow_returns_403(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_direct_popup(db, tenant_a)
        flow = _make_flow(db, popup, slug="apply-only", type="application")
        db.commit()

        response = client.get(
            f"/api/v1/checkout/{popup.slug}/{flow.slug}/runtime",
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 403, response.text


class TestSectionFieldTierParity:
    """risk-001: fields must resolve through the same tier-filtered
    `find_for_flow` list used for sections, never the unfiltered
    `FormSections.form_fields` ORM relationship."""

    def test_shared_section_never_leaks_another_flows_field(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        popup = _make_direct_popup(db, tenant_a)
        flow_a = _make_flow(db, popup, slug="flow-a")
        flow_b = _make_flow(db, popup, slug="flow-b")

        # A popup-shared section (no flow owns it).
        shared_section = _make_section(db, popup, label="Shared Section")
        _make_field(
            db,
            popup,
            shared_section,
            name="shared_field",
            label="Shared Field",
        )
        # flow_b owns a field that happens to point at the SAME shared
        # section_id (legal: section ownership and field ownership are
        # independent tiers).
        _make_field(
            db,
            popup,
            shared_section,
            name="flow_b_field",
            label="Flow B Field",
            sales_flow_id=flow_b.id,
        )
        db.commit()

        # flow_a owns no fields/sections of its own -> falls back to the
        # popup-shared tier for BOTH. It must see ONLY the shared field,
        # never flow_b's field that happens to share the section id.
        response = client.get(
            f"/api/v1/checkout/{popup.slug}/{flow_a.slug}/runtime",
            headers={"X-Tenant-Id": str(tenant_a.id)},
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert len(body["buyer_form"]) == 1
        field_labels = [f["label"] for f in body["buyer_form"][0]["form_fields"]]
        assert field_labels == ["Shared Field"]


class TestTranslationParity:
    """res-001: the runtime path must translate buyer_form/form_schema the
    same way form_field/router.py's portal schema endpoint already does."""

    def test_buyer_form_field_and_section_are_translated(
        self, client: TestClient, db: Session, tenant_a: Tenants
    ) -> None:
        from app.api.translation.models import Translations

        popup = _make_direct_popup(db, tenant_a)
        section = _make_section(db, popup, label="Buyer Info")
        field = _make_field(db, popup, section, name="first_name", label="Nombre")
        db.add(
            Translations(
                tenant_id=tenant_a.id,
                entity_type="form_section",
                entity_id=section.id,
                language="en",
                data={"label": "Buyer Info EN"},
            )
        )
        db.add(
            Translations(
                tenant_id=tenant_a.id,
                entity_type="form_field",
                entity_id=field.id,
                language="en",
                data={"label": "First Name EN"},
            )
        )
        db.commit()

        response = client.get(
            f"/api/v1/checkout/{popup.slug}/runtime",
            headers={
                "X-Tenant-Id": str(tenant_a.id),
                "Accept-Language": "en",
            },
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["buyer_form"][0]["label"] == "Buyer Info EN"
        assert body["buyer_form"][0]["form_fields"][0]["label"] == "First Name EN"
        schema = body["form_schema"]
        assert schema["custom_fields"][field.name]["label"] == "First Name EN"
