"""Tests for DATE form field min_date / max_date bounds.

Phase 1 — RED: tests are written before implementation.
"""
import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.form_field.crud import form_fields_crud
from app.api.form_field.models import FormFields
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _create_date_field(
    client: TestClient,
    token: str,
    popup_id: str,
    *,
    min_date: str | None = None,
    max_date: str | None = None,
) -> dict:
    payload: dict = {
        "popup_id": popup_id,
        "label": f"Event Date {uuid.uuid4().hex[:6]}",
        "field_type": "date",
    }
    if min_date is not None:
        payload["min_date"] = min_date
    if max_date is not None:
        payload["max_date"] = max_date

    resp = client.post(
        "/api/v1/form-fields",
        headers=_admin_headers(token),
        json=payload,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ---------------------------------------------------------------------------
# T1 — Column persistence + schema serialisation
# ---------------------------------------------------------------------------


class TestDateRangeColumns:
    """Test that min_date / max_date are persisted and returned in API responses."""

    def test_create_date_field_with_min_and_max(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """T1-a: POST a DATE field with both bounds → DB and response contain them."""
        data = _create_date_field(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            min_date="2025-06-01",
            max_date="2025-08-31",
        )
        assert data["min_date"] == "2025-06-01"
        assert data["max_date"] == "2025-08-31"

    def test_create_date_field_with_min_only(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """T1-b: POST with min_date only → max_date is null in response."""
        data = _create_date_field(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            min_date="2025-01-01",
        )
        assert data["min_date"] == "2025-01-01"
        assert data["max_date"] is None

    def test_create_date_field_with_max_only(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """T1-c: POST with max_date only → min_date is null in response."""
        data = _create_date_field(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            max_date="2025-12-31",
        )
        assert data["min_date"] is None
        assert data["max_date"] == "2025-12-31"

    def test_update_date_field_clears_bounds(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """T1-d: PATCH sets both to null → DB stores nulls."""
        # Create with bounds
        data = _create_date_field(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            min_date="2025-06-01",
            max_date="2025-08-31",
        )
        field_id = data["id"]

        # Clear bounds via PATCH
        resp = client.patch(
            f"/api/v1/form-fields/{field_id}",
            headers=_admin_headers(admin_token_tenant_a),
            json={"min_date": None, "max_date": None},
        )
        assert resp.status_code == 200, resp.text
        updated = resp.json()
        assert updated["min_date"] is None
        assert updated["max_date"] is None


# ---------------------------------------------------------------------------
# T5 — build_schema_for_popup() includes min_date / max_date
# ---------------------------------------------------------------------------


class TestBuildSchemaIncludesDateRange:
    """Test that build_schema_for_popup() serialises min_date / max_date."""

    def test_build_schema_includes_min_max(
        self,
        client: TestClient,
        db: Session,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """T5: build_schema_for_popup() returns min_date / max_date in field dict."""
        # Create a date field with bounds
        field_data = _create_date_field(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
            min_date="2025-03-01",
            max_date="2025-09-30",
        )
        field_name = field_data["name"]

        # Get schema via API
        resp = client.get(
            f"/api/v1/form-fields/schema/{popup_tenant_a.id}",
            headers=_admin_headers(admin_token_tenant_a),
        )
        assert resp.status_code == 200, resp.text
        schema = resp.json()

        # The custom field must appear in schema["custom_fields"]
        assert field_name in schema["custom_fields"], (
            f"Field {field_name!r} not found in custom_fields. "
            f"Got: {list(schema['custom_fields'].keys())}"
        )
        field_schema = schema["custom_fields"][field_name]
        assert field_schema["min_date"] == "2025-03-01"
        assert field_schema["max_date"] == "2025-09-30"

    def test_build_schema_field_with_no_bounds_has_null_values(
        self,
        client: TestClient,
        admin_token_tenant_a: str,
        popup_tenant_a: Popups,
    ) -> None:
        """T5-b: DATE field with no bounds → min_date / max_date keys present as null."""
        field_data = _create_date_field(
            client,
            admin_token_tenant_a,
            str(popup_tenant_a.id),
        )
        field_name = field_data["name"]

        resp = client.get(
            f"/api/v1/form-fields/schema/{popup_tenant_a.id}",
            headers=_admin_headers(admin_token_tenant_a),
        )
        assert resp.status_code == 200, resp.text
        schema = resp.json()

        assert field_name in schema["custom_fields"]
        field_schema = schema["custom_fields"][field_name]
        # Both keys should be present (even if null) so the frontend can rely on them
        assert "min_date" in field_schema
        assert "max_date" in field_schema
        assert field_schema["min_date"] is None
        assert field_schema["max_date"] is None


# ---------------------------------------------------------------------------
# T6 — validate_custom_fields() date-range enforcement
# ---------------------------------------------------------------------------


class TestValidateDateRange:
    """Unit-level tests of validate_custom_fields() for DATE range enforcement.

    These tests call the CRUD method directly to isolate the validation logic
    without going through the full application submission stack.
    """

    def _make_popup_with_bounded_date_field(
        self,
        db: Session,
        tenant: Tenants,
        min_date: str | None = None,
        max_date: str | None = None,
    ) -> tuple[Popups, str]:
        """Helper: create a Popup + FormField in-DB for direct CRUD tests."""
        popup = Popups(
            name=f"Validate Popup {uuid.uuid4().hex[:8]}",
            slug=f"validate-popup-{uuid.uuid4().hex[:8]}",
            tenant_id=tenant.id,
        )
        db.add(popup)
        db.flush()

        field = FormFields(
            tenant_id=tenant.id,
            popup_id=popup.id,
            name=f"event_date_{uuid.uuid4().hex[:6]}",
            label="Event Date",
            field_type="date",
            min_date=min_date,
            max_date=max_date,
        )
        db.add(field)
        db.commit()
        db.refresh(field)
        return popup, field.name

    def test_validate_date_before_min_raises_error(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """T6-a: value before min_date → validation error with field label."""
        popup, field_name = self._make_popup_with_bounded_date_field(
            db, tenant_a, min_date="2025-06-01", max_date="2025-08-31"
        )
        is_valid, errors = form_fields_crud.validate_custom_fields(
            db,
            popup.id,
            {field_name: "2025-05-15"},
        )
        assert not is_valid
        assert any("Event Date" in e for e in errors), errors
        assert any("2025-06-01" in e for e in errors), errors

    def test_validate_date_after_max_raises_error(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """T6-b: value after max_date → validation error with field label."""
        popup, field_name = self._make_popup_with_bounded_date_field(
            db, tenant_a, min_date="2025-06-01", max_date="2025-08-31"
        )
        is_valid, errors = form_fields_crud.validate_custom_fields(
            db,
            popup.id,
            {field_name: "2025-09-10"},
        )
        assert not is_valid
        assert any("Event Date" in e for e in errors), errors
        assert any("2025-08-31" in e for e in errors), errors

    def test_validate_date_within_bounds_accepted(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """T6-c: value within bounds → no error."""
        popup, field_name = self._make_popup_with_bounded_date_field(
            db, tenant_a, min_date="2025-06-01", max_date="2025-08-31"
        )
        is_valid, errors = form_fields_crud.validate_custom_fields(
            db,
            popup.id,
            {field_name: "2025-07-15"},
        )
        assert is_valid, errors

    def test_validate_date_on_min_boundary_accepted(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """T6-d: value == min_date (inclusive lower bound) → no error."""
        popup, field_name = self._make_popup_with_bounded_date_field(
            db, tenant_a, min_date="2025-06-01", max_date="2025-08-31"
        )
        is_valid, errors = form_fields_crud.validate_custom_fields(
            db,
            popup.id,
            {field_name: "2025-06-01"},
        )
        assert is_valid, errors

    def test_validate_date_on_max_boundary_accepted(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """T6-e: value == max_date (inclusive upper bound) → no error."""
        popup, field_name = self._make_popup_with_bounded_date_field(
            db, tenant_a, min_date="2025-06-01", max_date="2025-08-31"
        )
        is_valid, errors = form_fields_crud.validate_custom_fields(
            db,
            popup.id,
            {field_name: "2025-08-31"},
        )
        assert is_valid, errors

    def test_validate_date_no_bounds_always_accepted(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """T6-f: existing field with both bounds NULL → any date is accepted."""
        popup, field_name = self._make_popup_with_bounded_date_field(
            db, tenant_a, min_date=None, max_date=None
        )
        is_valid, errors = form_fields_crud.validate_custom_fields(
            db,
            popup.id,
            {field_name: "1900-01-01"},
        )
        assert is_valid, errors

    def test_validate_date_only_min_no_max_rejects_before_min(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """T6-g: only min_date set, value before min → error."""
        popup, field_name = self._make_popup_with_bounded_date_field(
            db, tenant_a, min_date="2025-01-01", max_date=None
        )
        is_valid, errors = form_fields_crud.validate_custom_fields(
            db,
            popup.id,
            {field_name: "2024-12-31"},
        )
        assert not is_valid
        assert any("2025-01-01" in e for e in errors), errors

    def test_validate_date_only_max_no_min_rejects_after_max(
        self,
        db: Session,
        tenant_a: Tenants,
    ) -> None:
        """T6-h: only max_date set, value after max → error."""
        popup, field_name = self._make_popup_with_bounded_date_field(
            db, tenant_a, min_date=None, max_date="2025-12-31"
        )
        is_valid, errors = form_fields_crud.validate_custom_fields(
            db,
            popup.id,
            {field_name: "2026-01-01"},
        )
        assert not is_valid
        assert any("2025-12-31" in e for e in errors), errors
