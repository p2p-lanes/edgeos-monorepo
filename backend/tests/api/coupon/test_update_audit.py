import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from app.api.audit_log.constants import AuditAction
from app.api.audit_log.models import AuditLog
from app.api.coupon.models import Coupons
from app.api.popup.models import Popups
from tests._flow_helpers import coupon_flow_id


def test_coupon_update_records_ai_audit_metadata(
    client: TestClient,
    db: Session,
    popup_tenant_a: Popups,
    admin_token_tenant_a: str,
) -> None:
    coupon = Coupons(
        id=uuid.uuid4(),
        tenant_id=popup_tenant_a.tenant_id,
        popup_id=popup_tenant_a.id,
        sales_flow_id=coupon_flow_id(db, popup_tenant_a.id),
        code=f"AIUPDATE{uuid.uuid4().hex[:8].upper()}",
        discount_value=50,
        max_uses=20,
        current_uses=0,
        is_active=True,
    )
    db.add(coupon)
    db.commit()

    response = client.patch(
        f"/api/v1/coupons/{coupon.id}",
        headers={
            "Authorization": f"Bearer {admin_token_tenant_a}",
            "X-EdgeOS-AI-Tool-Call-Id": "tool-call-update-1",
        },
        json={"max_uses": 10},
    )

    assert response.status_code == 200, response.text
    assert response.json()["max_uses"] == 10

    db.expire_all()
    audit = db.exec(
        select(AuditLog)
        .where(
            AuditLog.entity_id == coupon.id,
            AuditLog.action == AuditAction.COUPON_UPDATED,
        )
        .order_by(AuditLog.created_at.desc())
    ).first()
    assert audit is not None
    assert audit.details is not None
    assert audit.details["via_ai"] is True
    assert audit.details["ai_tool_call_id"] == "tool-call-update-1"
    assert audit.details["changes"]["max_uses"] == {"from": 20, "to": 10}
