"""Only application flows can have an approval strategy.

A direct-sale or upsale flow never produces an application, so a review
strategy attached to one is configuration that can never run — the kind of
setting that looks configured and does nothing.

Scenarios:
- An application flow accepts a strategy.
- A direct flow is refused with 422.
- An upsale flow is refused with 422.
- A flow from another popup is refused with 404, before the type check.
"""

import uuid

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.approval_strategy.crud import approval_strategies_crud
from app.api.approval_strategy.schemas import (
    ApprovalStrategyCreate,
    ApprovalStrategyType,
)
from app.api.popup.models import Popups
from app.api.sales_flow.models import SalesFlows
from app.api.tenant.models import Tenants
from tests._flow_helpers import provision_default_flow


def _make_popup(
    db: Session, tenant: Tenants, *, default_flow_type: str = "application"
) -> Popups:
    popup = Popups(
        tenant_id=tenant.id,
        name=f"Strategy Type Popup {uuid.uuid4().hex[:6]}",
        slug=f"strategy-type-{uuid.uuid4().hex[:8]}",
    )
    db.add(popup)
    db.commit()
    db.refresh(popup)
    provision_default_flow(db, popup, sale_type=default_flow_type)
    return popup


def _make_flow(db: Session, popup: Popups, *, flow_type: str) -> SalesFlows:
    flow = SalesFlows(
        tenant_id=popup.tenant_id,
        popup_id=popup.id,
        type=flow_type,
        slug=f"{flow_type}-{uuid.uuid4().hex[:6]}",
        name=flow_type,
    )
    db.add(flow)
    db.commit()
    db.refresh(flow)
    return flow


def _create(db: Session, popup: Popups, flow: SalesFlows):
    return approval_strategies_crud.create_for_popup(
        db,
        popup.id,
        popup.tenant_id,
        ApprovalStrategyCreate(strategy_type=ApprovalStrategyType.AUTO_ACCEPT),
        sales_flow_id=flow.id,
    )


def test_an_application_flow_accepts_a_strategy(db: Session, tenant_a: Tenants) -> None:
    popup = _make_popup(db, tenant_a)
    flow = _make_flow(db, popup, flow_type="application")

    strategy = _create(db, popup, flow)

    assert strategy.sales_flow_id == flow.id


def test_a_gathering_strategy_does_not_attach_to_its_direct_default(
    db: Session, tenant_a: Tenants
) -> None:
    popup = _make_popup(db, tenant_a, default_flow_type="direct")

    strategy = approval_strategies_crud.create_for_popup(
        db,
        popup.id,
        popup.tenant_id,
        ApprovalStrategyCreate(strategy_type=ApprovalStrategyType.AUTO_ACCEPT),
    )

    assert strategy.sales_flow_id is None


def test_popup_get_returns_auto_accept_without_a_row_for_a_direct_default(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
) -> None:
    response = client.post(
        "/api/v1/popups",
        headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        json={"name": f"Direct Strategy {uuid.uuid4().hex[:8]}", "sale_type": "direct"},
    )
    assert response.status_code == 201, response.text
    popup_id = uuid.UUID(response.json()["id"])
    explicit = approval_strategies_crud.get_by_popup(db, popup_id)
    assert explicit is not None
    db.delete(explicit)
    db.commit()

    response = client.get(
        f"/api/v1/popups/{popup_id}/approval-strategy",
        headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["strategy_type"] == "auto_accept"
    assert response.json()["sales_flow_id"] is None


def test_disabling_review_resets_an_explicit_strategy_to_auto_accept(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
) -> None:
    response = client.post(
        "/api/v1/popups",
        headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        json={"name": f"Reset Strategy {uuid.uuid4().hex[:8]}"},
    )
    assert response.status_code == 201, response.text
    popup_id = uuid.UUID(response.json()["id"])
    strategy = approval_strategies_crud.get_by_popup(db, popup_id)
    assert strategy is not None
    strategy.strategy_type = ApprovalStrategyType.ANY_REVIEWER
    db.add(strategy)
    db.commit()

    response = client.delete(
        f"/api/v1/popups/{popup_id}/approval-strategy",
        headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
    )

    assert response.status_code == 204, response.text
    db.expire_all()
    reset = approval_strategies_crud.get_by_popup(db, popup_id)
    assert reset is not None
    assert reset.id == strategy.id
    assert reset.strategy_type == ApprovalStrategyType.AUTO_ACCEPT


def test_disabling_review_materializes_auto_accept_for_a_legacy_absence(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
) -> None:
    response = client.post(
        "/api/v1/popups",
        headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
        json={"name": f"Legacy Strategy {uuid.uuid4().hex[:8]}"},
    )
    assert response.status_code == 201, response.text
    popup_id = uuid.UUID(response.json()["id"])
    strategy = approval_strategies_crud.get_by_popup(db, popup_id)
    assert strategy is not None
    db.delete(strategy)
    db.commit()

    response = client.delete(
        f"/api/v1/popups/{popup_id}/approval-strategy",
        headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
    )

    assert response.status_code == 204, response.text
    materialized = approval_strategies_crud.get_by_popup(db, popup_id)
    assert materialized is not None
    assert materialized.strategy_type == ApprovalStrategyType.AUTO_ACCEPT


def test_a_direct_flow_is_refused(db: Session, tenant_a: Tenants) -> None:
    popup = _make_popup(db, tenant_a)
    flow = _make_flow(db, popup, flow_type="direct")

    with pytest.raises(HTTPException) as exc:
        _create(db, popup, flow)

    assert exc.value.status_code == 422
    assert "application flows" in str(exc.value.detail)


def test_an_upsale_flow_is_refused(db: Session, tenant_a: Tenants) -> None:
    popup = _make_popup(db, tenant_a)
    flow = _make_flow(db, popup, flow_type="upsale")

    with pytest.raises(HTTPException) as exc:
        _create(db, popup, flow)

    assert exc.value.status_code == 422


def test_a_flow_from_another_popup_is_refused(db: Session, tenant_a: Tenants) -> None:
    """Cross-popup injection is rejected before the type is even read."""
    popup = _make_popup(db, tenant_a)
    other_popup = _make_popup(db, tenant_a)
    foreign = _make_flow(db, other_popup, flow_type="application")

    with pytest.raises(HTTPException) as exc:
        _create(db, popup, foreign)

    assert exc.value.status_code == 404
