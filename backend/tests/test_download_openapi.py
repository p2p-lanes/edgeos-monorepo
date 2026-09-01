from app.main import application


def test_download_endpoints_declare_their_runtime_media_types() -> None:
    schema = application.openapi()
    expected = {
        "/api/v1/applications/my/directory/{popup_id}/csv": "text/csv",
        "/api/v1/attendees/export.csv": "text/csv",
        "/api/v1/events/public/calendar.ics": "text/calendar",
        "/api/v1/events/{event_id}/ics": "text/calendar",
        "/api/v1/events/portal/events/{event_id}/ics": "text/calendar",
        "/api/v1/payments/{payment_id}/invoice": "application/pdf",
        "/api/v1/payments/my/{payment_id}/invoice": "application/pdf",
    }

    for path, media_type in expected.items():
        content = schema["paths"][path]["get"]["responses"]["200"]["content"]
        assert media_type in content
        assert "application/json" not in content
