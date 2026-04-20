import importlib.util
import uuid
from decimal import Decimal
from pathlib import Path

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.payment.models import Payments
from app.api.payment.schemas import PaymentStatus
from app.api.popup.models import Popups
from app.api.shared.enums import CheckoutMode
from app.api.tenant.models import Tenants


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_popup(
    client: TestClient,
    admin_token_tenant_a: str,
    sale_type: str = "application",
) -> dict[str, str]:
    response = client.post(
        "/api/v1/popups",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "name": f"Checkout Mode {sale_type} {uuid.uuid4().hex[:8]}",
            "sale_type": sale_type,
        },
    )

    assert response.status_code == 201
    return response.json()


def _load_migration_module():
    migration_path = (
        Path(__file__).resolve().parents[1] / "app" / "alembic" / "versions"
    )
    matches = list(migration_path.glob("*_popup_checkout_mode.py"))
    assert matches, "popup checkout mode migration file not found"

    module_path = matches[0]
    spec = importlib.util.spec_from_file_location(module_path.stem, module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestPopupCheckoutModeApi:
    def test_create_popup_persists_derived_checkout_mode(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
    ) -> None:
        response = client.post(
            "/api/v1/popups",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "name": f"Direct Checkout {uuid.uuid4().hex[:8]}",
                "sale_type": "direct",
            },
        )

        assert response.status_code == 201
        data = response.json()
        assert data["sale_type"] == "direct"
        assert data["checkout_mode"] == "simple_quantity"

        popup = db.get(Popups, uuid.UUID(data["id"]))
        assert popup is not None
        assert popup.checkout_mode == CheckoutMode.simple_quantity

    def test_create_popup_rejects_conflicting_checkout_mode_input(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
    ) -> None:
        response = client.post(
            "/api/v1/popups",
            headers=_admin_headers(admin_token_tenant_a),
            json={
                "name": f"Conflicting Checkout {uuid.uuid4().hex[:8]}",
                "sale_type": "application",
                "checkout_mode": "simple_quantity",
            },
        )

        assert response.status_code == 422
        assert "checkout_mode" in response.text

    def test_update_popup_rederives_checkout_mode_before_payments(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        db: Session,
    ) -> None:
        popup = _create_popup(client, admin_token_tenant_a, sale_type="application")

        response = client.patch(
            f"/api/v1/popups/{popup['id']}",
            headers=_admin_headers(admin_token_tenant_a),
            json={"sale_type": "direct"},
        )

        assert response.status_code == 200
        data = response.json()
        assert data["sale_type"] == "direct"
        assert data["checkout_mode"] == "simple_quantity"

        updated_popup = db.get(Popups, uuid.UUID(popup["id"]))
        assert updated_popup is not None
        assert updated_popup.checkout_mode == CheckoutMode.simple_quantity

    def test_update_popup_blocks_sale_type_after_approved_payment(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        tenant_a: Tenants,
        db: Session,
    ) -> None:
        popup = _create_popup(client, admin_token_tenant_a, sale_type="application")
        popup_id = uuid.UUID(popup["id"])

        approved_payment = Payments(
            tenant_id=tenant_a.id,
            popup_id=popup_id,
            status=PaymentStatus.APPROVED.value,
            amount=Decimal("125.00"),
            currency="USD",
        )
        db.add(approved_payment)
        db.commit()

        response = client.patch(
            f"/api/v1/popups/{popup['id']}",
            headers=_admin_headers(admin_token_tenant_a),
            json={"sale_type": "direct"},
        )

        assert response.status_code == 422
        assert "approved payment" in response.text

        unchanged_popup = db.get(Popups, popup_id)
        assert unchanged_popup is not None
        assert unchanged_popup.sale_type == "application"
        assert unchanged_popup.checkout_mode == CheckoutMode.pass_system


class TestPopupCheckoutModeMigration:
    def test_backfill_helper_maps_sale_type_to_checkout_mode(self, db: Session) -> None:
        migration_module = _load_migration_module()
        connection = db.connection()
        table_name = f"popup_checkout_mode_backfill_{uuid.uuid4().hex[:8]}"

        connection.exec_driver_sql(
            f"CREATE TABLE {table_name} (sale_type TEXT NOT NULL, checkout_mode TEXT NULL)"
        )
        try:
            connection.exec_driver_sql(
                f"INSERT INTO {table_name} (sale_type) VALUES ('application'), ('direct')"
            )

            migration_module.backfill_checkout_mode(connection, table_name)

            rows = connection.exec_driver_sql(
                f"SELECT sale_type, checkout_mode FROM {table_name} ORDER BY sale_type"
            ).fetchall()
        finally:
            connection.exec_driver_sql(f"DROP TABLE {table_name}")

        assert rows == [
            ("application", "pass_system"),
            ("direct", "simple_quantity"),
        ]
