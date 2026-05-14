"""Tests verifying that companion-related code has been removed from the application module.

PR 2 tasks T2.1a — these tests are written RED-first to drive the removal.
"""

from fastapi.testclient import TestClient


def test_application_create_has_no_companions_field():
    """ApplicationCreate schema must not have a companions field."""
    from app.api.application.schemas import ApplicationCreate

    schema_fields = set(ApplicationCreate.model_fields.keys())
    assert "companions" not in schema_fields, (
        "companions field must be removed from ApplicationCreate"
    )


def test_application_admin_create_has_no_companions_field():
    """ApplicationAdminCreate schema must not have a companions field."""
    from app.api.application.schemas import ApplicationAdminCreate

    schema_fields = set(ApplicationAdminCreate.model_fields.keys())
    assert "companions" not in schema_fields, (
        "companions field must be removed from ApplicationAdminCreate"
    )


def test_application_public_has_no_brings_spouse():
    """ApplicationPublic must not have brings_spouse field."""
    from app.api.application.schemas import ApplicationPublic

    schema_fields = set(ApplicationPublic.model_fields.keys())
    assert "brings_spouse" not in schema_fields, (
        "brings_spouse must be removed from ApplicationPublic"
    )


def test_application_public_has_no_brings_kids():
    """ApplicationPublic must not have brings_kids field."""
    from app.api.application.schemas import ApplicationPublic

    schema_fields = set(ApplicationPublic.model_fields.keys())
    assert "brings_kids" not in schema_fields, (
        "brings_kids must be removed from ApplicationPublic"
    )


def test_application_public_has_no_kid_count():
    """ApplicationPublic must not have kid_count field."""
    from app.api.application.schemas import ApplicationPublic

    schema_fields = set(ApplicationPublic.model_fields.keys())
    assert "kid_count" not in schema_fields, (
        "kid_count must be removed from ApplicationPublic"
    )


def test_application_crud_has_no_create_companions_method():
    """ApplicationsCRUD must not have a _create_companions method."""
    from app.api.application.crud import ApplicationsCRUD

    assert not hasattr(ApplicationsCRUD, "_create_companions"), (
        "_create_companions method must be removed from ApplicationsCRUD"
    )


def test_application_model_has_no_brings_spouse_property():
    """Applications model must not have brings_spouse property."""
    from app.api.application.models import Applications

    assert not hasattr(Applications, "brings_spouse"), (
        "brings_spouse property must be removed from Applications model"
    )


def test_application_model_has_no_brings_kids_property():
    """Applications model must not have brings_kids property."""
    from app.api.application.models import Applications

    assert not hasattr(Applications, "brings_kids"), (
        "brings_kids property must be removed from Applications model"
    )


def test_application_model_has_no_kid_count_property():
    """Applications model must not have kid_count property."""
    from app.api.application.models import Applications

    assert not hasattr(Applications, "kid_count"), (
        "kid_count property must be removed from Applications model"
    )


def test_application_model_has_no_get_main_attendee_method():
    """Applications model must not have get_main_attendee method."""
    from app.api.application.models import Applications

    assert not hasattr(Applications, "get_main_attendee"), (
        "get_main_attendee method must be removed from Applications model"
    )


def test_companion_create_schema_does_not_exist():
    """CompanionCreate schema must not exist in attendee schemas."""
    import app.api.attendee.schemas as attendee_schemas

    assert not hasattr(attendee_schemas, "CompanionCreate"), (
        "CompanionCreate must be removed from attendee schemas"
    )


def test_form_section_kind_has_no_companions():
    """FormSectionKind must not have COMPANIONS value."""
    from app.api.form_section.schemas import FormSectionKind

    values = [e.value for e in FormSectionKind]
    assert "companions" not in values, "COMPANIONS must be removed from FormSectionKind"


def test_form_section_create_rejects_companions_kind(
    client: TestClient, admin_token_tenant_a: str, popup_tenant_a
):
    """POST /form-sections with kind='companions' must fail (422 or 400)."""
    popup_id = str(popup_tenant_a.id)

    resp = client.post(
        "/api/v1/form-sections",
        json={
            "popup_id": popup_id,
            "label": "Companions",
            "kind": "companions",
        },
        headers={
            "Authorization": f"Bearer {admin_token_tenant_a}",
        },
    )
    # Must fail — companions kind no longer exists in the enum
    assert resp.status_code in (400, 422), (
        f"Expected 400 or 422 for companions kind, got {resp.status_code}"
    )


def test_popup_create_ignores_allows_spouse(
    client: TestClient, admin_token_tenant_a: str
):
    """Creating a popup with allows_spouse must be ignored or rejected."""
    resp = client.post(
        "/api/v1/popups",
        json={
            "name": "Test Allows Spouse PR2",
            "allows_spouse": True,
            "sale_type": "application",
        },
        headers={"Authorization": f"Bearer {admin_token_tenant_a}"},
    )
    # Either 201 (field ignored) or 422 (field rejected) — must not persist
    if resp.status_code == 201:
        data = resp.json()
        assert "allows_spouse" not in data, (
            "allows_spouse must not appear in popup response"
        )
    else:
        assert resp.status_code == 422, (
            f"Expected 201 (ignored) or 422 (rejected), got {resp.status_code}"
        )


def test_attenees_directory_entry_has_no_brings_kids():
    """AttendeesDirectoryEntry must not have brings_kids field."""
    from app.api.application.schemas import AttendeesDirectoryEntry

    schema_fields = set(AttendeesDirectoryEntry.model_fields.keys())
    assert "brings_kids" not in schema_fields, (
        "brings_kids must be removed from AttendeesDirectoryEntry"
    )
