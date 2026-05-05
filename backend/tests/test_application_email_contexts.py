from datetime import UTC, datetime
from types import SimpleNamespace

from app.api.application.schemas import ApplicationStatus
from app.services.email_helpers import send_application_status_email


class _FakeEmailService:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def send_application_received(self, **kwargs):
        self.calls.append({"method": "received", **kwargs})
        return True

    async def send_application_rejected(self, **kwargs):
        self.calls.append({"method": "rejected", **kwargs})
        return True


def test_application_received_email_uses_application_human_and_submitted_at(
    monkeypatch,
):
    fake_service = _FakeEmailService()
    monkeypatch.setattr(
        "app.services.email_helpers.get_email_service", lambda: fake_service
    )

    application = SimpleNamespace(
        status=ApplicationStatus.IN_REVIEW.value,
        submitted_at=datetime(2026, 4, 24, 15, 30, tzinfo=UTC),
        popup_id="popup-1",
        popup=SimpleNamespace(
            name="Edge Summit",
            tenant=SimpleNamespace(
                sender_email="hello@example.com",
                sender_name="Edge Team",
            ),
        ),
        human=SimpleNamespace(
            first_name="Ada",
            last_name="Lovelace",
            email="ada@example.com",
        ),
    )
    stale_human = SimpleNamespace(
        first_name="",
        last_name="",
        email="stale@example.com",
    )

    import asyncio

    asyncio.run(send_application_status_email(application, stale_human, db=None))

    assert len(fake_service.calls) == 1
    call = fake_service.calls[0]

    assert call["method"] == "received"
    assert call["to"] == "ada@example.com"
    assert call["context"].first_name == "Ada"
    assert call["context"].last_name == "Lovelace"
    assert call["context"].email == "ada@example.com"
    assert call["context"].submitted_at == "April 24, 2026 15:30 UTC"


def test_application_rejected_email_uses_application_human_details(monkeypatch):
    fake_service = _FakeEmailService()
    monkeypatch.setattr(
        "app.services.email_helpers.get_email_service", lambda: fake_service
    )

    application = SimpleNamespace(
        status=ApplicationStatus.REJECTED.value,
        submitted_at=None,
        popup_id="popup-1",
        popup=SimpleNamespace(
            name="Edge Summit",
            tenant=SimpleNamespace(
                sender_email="hello@example.com",
                sender_name="Edge Team",
            ),
        ),
        human=SimpleNamespace(
            first_name="Grace",
            last_name="Hopper",
            email="grace@example.com",
        ),
    )
    stale_human = SimpleNamespace(
        first_name="",
        last_name="",
        email="stale@example.com",
    )

    import asyncio

    asyncio.run(send_application_status_email(application, stale_human, db=None))

    assert len(fake_service.calls) == 1
    call = fake_service.calls[0]

    assert call["method"] == "rejected"
    assert call["to"] == "grace@example.com"
    assert call["context"].first_name == "Grace"
    assert call["context"].last_name == "Hopper"
