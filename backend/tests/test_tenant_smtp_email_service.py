import asyncio
import uuid
from types import SimpleNamespace

import aiosmtplib

from app.services.email.service import EmailService
from app.utils.encryption import encrypt


class _FakeSession:
    def __init__(self, tenant):
        self.tenant = tenant

    def get(self, _model, _id):
        return self.tenant


def _tenant(**overrides):
    data = {
        "smtp_host": None,
        "smtp_port": 587,
        "smtp_user": None,
        "smtp_password_encrypted": None,
        "smtp_tls": True,
        "smtp_ssl": False,
    }
    data.update(overrides)
    return SimpleNamespace(**data)


def test_send_email_uses_tenant_smtp(monkeypatch):
    calls = []

    async def fake_send(_message, **kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    monkeypatch.setattr("app.services.email.service.settings.SMTP_HOST", "global-smtp")
    monkeypatch.setattr("app.services.email.service.settings.SMTP_PORT", 2525)
    monkeypatch.setattr("app.services.email.service.settings.SMTP_TLS", True)
    monkeypatch.setattr("app.services.email.service.settings.SMTP_SSL", False)
    monkeypatch.setattr("app.services.email.service.settings.SMTP_USER", "global-user")
    monkeypatch.setattr("app.services.email.service.settings.SMTP_PASSWORD", "global-pass")
    monkeypatch.setattr("app.services.email.service.settings.SENDER_EMAIL", "global@test.com")

    tenant_id = uuid.uuid4()
    tenant = _tenant(
        smtp_host="tenant-smtp",
        smtp_port=1025,
        smtp_user="tenant-user",
        smtp_password_encrypted=encrypt("tenant-pass"),
        smtp_tls=False,
        smtp_ssl=False,
    )

    ok = asyncio.run(
        EmailService().send_email(
            to="recipient@test.com",
            subject="Subject",
            html_content="<p>Hello</p>",
            from_address="sender@test.com",
            tenant_id=tenant_id,
            db_session=_FakeSession(tenant),
        )
    )

    assert ok is True
    assert calls == [
        {
            "hostname": "tenant-smtp",
            "port": 1025,
            "start_tls": False,
            "use_tls": False,
            "username": "tenant-user",
            "password": "tenant-pass",
        }
    ]


def test_send_email_falls_back_to_global_when_tenant_has_no_smtp(monkeypatch):
    calls = []

    async def fake_send(_message, **kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    monkeypatch.setattr("app.services.email.service.settings.SMTP_HOST", "global-smtp")
    monkeypatch.setattr("app.services.email.service.settings.SMTP_PORT", 2525)
    monkeypatch.setattr("app.services.email.service.settings.SMTP_TLS", True)
    monkeypatch.setattr("app.services.email.service.settings.SMTP_SSL", False)
    monkeypatch.setattr("app.services.email.service.settings.SMTP_USER", "global-user")
    monkeypatch.setattr("app.services.email.service.settings.SMTP_PASSWORD", "global-pass")
    monkeypatch.setattr("app.services.email.service.settings.SENDER_EMAIL", "global@test.com")

    ok = asyncio.run(
        EmailService().send_email(
            to="recipient@test.com",
            subject="Subject",
            html_content="<p>Hello</p>",
            tenant_id=uuid.uuid4(),
            db_session=_FakeSession(_tenant()),
        )
    )

    assert ok is True
    assert calls[0]["hostname"] == "global-smtp"
    assert calls[0]["username"] == "global-user"


def test_tenant_smtp_failure_does_not_fallback_to_global(monkeypatch):
    calls = []

    async def fake_send(_message, **kwargs):
        calls.append(kwargs)
        raise aiosmtplib.SMTPException("tenant provider down")

    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    monkeypatch.setattr("app.services.email.service.settings.SMTP_HOST", "global-smtp")
    monkeypatch.setattr("app.services.email.service.settings.SENDER_EMAIL", "global@test.com")

    tenant = _tenant(smtp_host="tenant-smtp", smtp_tls=False, smtp_ssl=False)
    ok = asyncio.run(
        EmailService().send_email(
            to="recipient@test.com",
            subject="Subject",
            html_content="<p>Hello</p>",
            tenant_id=uuid.uuid4(),
            db_session=_FakeSession(tenant),
        )
    )

    assert ok is False
    assert [call["hostname"] for call in calls] == ["tenant-smtp"]


def test_incomplete_tenant_smtp_fails_without_global_fallback(monkeypatch):
    calls = []

    async def fake_send(_message, **kwargs):
        calls.append(kwargs)

    monkeypatch.setattr(aiosmtplib, "send", fake_send)
    monkeypatch.setattr("app.services.email.service.settings.SMTP_HOST", "global-smtp")
    monkeypatch.setattr("app.services.email.service.settings.SENDER_EMAIL", "global@test.com")

    tenant = _tenant(smtp_host="tenant-smtp", smtp_user="missing-password")
    ok = asyncio.run(
        EmailService().send_email(
            to="recipient@test.com",
            subject="Subject",
            html_content="<p>Hello</p>",
            tenant_id=uuid.uuid4(),
            db_session=_FakeSession(tenant),
        )
    )

    assert ok is False
    assert calls == []
