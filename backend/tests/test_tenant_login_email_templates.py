import uuid

import pytest
from sqlmodel import Session, select

from app.api.email_template.models import EmailTemplates
from app.api.popup.models import Popups
from app.api.tenant.models import Tenants
from app.api.user.models import Users
from app.services.email.service import EmailService


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _delete_tenant_template(
    db: Session,
    tenant_id: uuid.UUID,
    template_type: str,
) -> None:
    statement = select(EmailTemplates).where(
        EmailTemplates.tenant_id == tenant_id,
        EmailTemplates.popup_id == None,  # noqa: E711
        EmailTemplates.template_type == template_type,
    )
    for template in db.exec(statement):
        db.delete(template)
    db.commit()


def _create_auth_template(
    client,
    token: str,
    *,
    template_type: str,
    subject: str,
    html_content: str,
    is_active: bool = True,
):
    return client.post(
        "/api/v1/email-templates",
        headers=_admin_headers(token),
        json={
            "template_type": template_type,
            "subject": subject,
            "html_content": html_content,
            "is_active": is_active,
        },
    )


def _create_popup_template(
    client,
    token: str,
    popup_id: uuid.UUID,
    *,
    template_type: str,
    subject: str,
    html_content: str,
    is_active: bool = True,
):
    return client.post(
        "/api/v1/email-templates",
        headers=_admin_headers(token),
        json={
            "popup_id": str(popup_id),
            "template_type": template_type,
            "subject": subject,
            "html_content": html_content,
            "is_active": is_active,
        },
    )


@pytest.mark.usefixtures("tenant_a", "popup_tenant_a")
def test_template_types_expose_scope_metadata(client, admin_token_tenant_a: str):
    response = client.get(
        "/api/v1/email-templates/types",
        headers=_admin_headers(admin_token_tenant_a),
    )

    assert response.status_code == 200

    by_type = {item["type"]: item for item in response.json()}

    assert by_type["login_code_human"]["scope"] == "tenant"
    assert by_type["application_received"]["scope"] == "popup"
    assert any(
        variable["name"] == "auth_code"
        for variable in by_type["login_code_human"]["variables"]
    )
    assert "login_code_user" not in by_type


def test_portal_login_templates_can_be_managed_without_popup_and_are_unique_per_tenant(
    client,
    admin_token_tenant_a: str,
):
    create_response = _create_auth_template(
        client,
        admin_token_tenant_a,
        template_type="login_code_human",
        subject="Portal login {{ auth_code }}",
        html_content="<html><body>Portal user code {{ auth_code }}</body></html>",
    )

    assert create_response.status_code == 201
    assert create_response.json()["popup_id"] is None

    list_response = client.get(
        "/api/v1/email-templates",
        headers=_admin_headers(admin_token_tenant_a),
    )

    assert list_response.status_code == 200
    assert [item["template_type"] for item in list_response.json()["results"]] == [
        "login_code_human"
    ]

    duplicate_response = _create_auth_template(
        client,
        admin_token_tenant_a,
        template_type="login_code_human",
        subject="Duplicate",
        html_content="<html><body>Duplicate</body></html>",
    )

    assert duplicate_response.status_code == 400
    assert duplicate_response.json()["detail"] == (
        "This workspace already has a custom Portal Login Code template. Open it from the list to edit it."
    )


def test_backoffice_login_template_is_not_customizable(client, admin_token_tenant_a: str):
    response = _create_auth_template(
        client,
        admin_token_tenant_a,
        template_type="login_code_user",
        subject="Should fail",
        html_content="<html><body>Nope</body></html>",
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "This email template can't be customized from backoffice"
    )


def test_popup_templates_still_require_popup_context(client, admin_token_tenant_a: str):
    response = client.post(
        "/api/v1/email-templates",
        headers=_admin_headers(admin_token_tenant_a),
        json={
            "template_type": "application_received",
            "subject": "Popup required",
            "html_content": "<html><body>Popup required</body></html>",
        },
    )

    assert response.status_code == 400
    assert response.json()["detail"] == (
        "Select a popup before managing the Application Received template"
    )


def test_popup_communications_ignore_tenant_auth_templates(
    client,
    db: Session,
    admin_token_tenant_a: str,
    popup_tenant_a: Popups,
):
    _delete_tenant_template(db, popup_tenant_a.tenant_id, "login_code_human")

    auth_response = _create_auth_template(
        client,
        admin_token_tenant_a,
        template_type="login_code_human",
        subject="Tenant auth",
        html_content="<html><body>Tenant auth template {{ auth_code }}</body></html>",
    )
    assert auth_response.status_code == 201

    popup_response = _create_popup_template(
        client,
        admin_token_tenant_a,
        popup_tenant_a.id,
        template_type="application_received",
        subject="Popup subject",
        html_content="<html><body>Popup communication for {{ popup_name }}</body></html>",
    )
    assert popup_response.status_code == 201

    rendered_html, rendered_subject = EmailService().render_with_fallback(
        template_type="application_received",
        context={"popup_name": popup_tenant_a.name},
        popup_id=popup_tenant_a.id,
        db_session=db,
    )

    assert "Popup communication for" in rendered_html
    assert "Tenant auth template" not in rendered_html
    assert rendered_subject == "Popup subject"


def test_inactive_tenant_auth_templates_fall_back_to_default_file(
    client,
    db: Session,
    monkeypatch,
    admin_user_tenant_a: Users,
    admin_token_tenant_a: str,
):
    _delete_tenant_template(db, admin_user_tenant_a.tenant_id, "login_code_human")

    create_response = _create_auth_template(
        client,
        admin_token_tenant_a,
        template_type="login_code_human",
        subject="Inactive custom subject",
        html_content="<html><body>Inactive custom {{ auth_code }}</body></html>",
        is_active=False,
    )
    assert create_response.status_code == 201

    captured: dict[str, str] = {}

    async def fake_send_email(_self, **kwargs):
        captured["subject"] = kwargs["subject"]
        captured["html_content"] = kwargs["html_content"]
        return True

    monkeypatch.setattr(EmailService, "send_email", fake_send_email)

    human_email = f"pending-{uuid.uuid4().hex[:8]}@test.com"
    response = client.post(
        "/api/v1/auth/human/login",
        json={
            "tenant_id": str(admin_user_tenant_a.tenant_id),
            "email": human_email,
            "red_flag": False,
        },
    )

    assert response.status_code == 200
    assert "Inactive custom" not in captured["html_content"]
    assert captured["subject"] == "Your Verification Code - Test Tenant A"


def test_portal_login_route_uses_tenant_scoped_custom_template(
    client,
    db: Session,
    monkeypatch,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
):
    _delete_tenant_template(db, tenant_a.id, "login_code_human")

    human_template_response = _create_auth_template(
        client,
        admin_token_tenant_a,
        template_type="login_code_human",
        subject="Human login for {{ tenant_name }}",
        html_content="<html><body>Human custom code {{ auth_code }}</body></html>",
    )
    assert human_template_response.status_code == 201

    captured_calls: list[dict[str, str]] = []

    async def fake_send_email(_self, **kwargs):
        captured_calls.append(
            {
                "subject": kwargs["subject"],
                "html_content": kwargs["html_content"],
                "to": kwargs["to"],
            }
        )
        return True

    monkeypatch.setattr(EmailService, "send_email", fake_send_email)

    human_email = f"pending-{uuid.uuid4().hex[:8]}@test.com"
    human_response = client.post(
        "/api/v1/auth/human/login",
        json={
            "tenant_id": str(tenant_a.id),
            "email": human_email,
            "red_flag": False,
        },
    )

    assert human_response.status_code == 200
    assert captured_calls[0]["subject"] == "Human login for Test Tenant A"
    assert "Human custom code" in captured_calls[0]["html_content"]
