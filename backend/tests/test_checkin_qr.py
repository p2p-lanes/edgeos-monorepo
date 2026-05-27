"""Tests for the check-in QR generation/hosting service."""

from unittest.mock import MagicMock, patch

from app.services.checkin_qr import (
    build_checkin_qr_payload,
    checkin_qr_storage_key,
    generate_checkin_qr_url,
    render_checkin_qr_png,
    sample_checkin_pass_preview_vars,
)

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def test_payload_matches_portal_json_stringify_exactly() -> None:
    # Portal QRcode.tsx encodes JSON.stringify({ code }) -> no whitespace.
    # The scanner won't recognise a payload with different bytes.
    assert build_checkin_qr_payload("ABCDEFGH") == '{"code":"ABCDEFGH"}'


def test_render_returns_valid_png() -> None:
    png = render_checkin_qr_png("ABCDEFGH")
    assert png.startswith(PNG_MAGIC)
    assert len(png) > 0


def test_storage_key_is_deterministic_and_namespaced() -> None:
    key1 = checkin_qr_storage_key("ABCDEFGH")
    key2 = checkin_qr_storage_key("ABCDEFGH")
    assert key1 == key2
    assert key1.startswith("checkin-qr/")
    assert key1.endswith(".png")
    # Different codes -> different (non-guessable) keys
    assert checkin_qr_storage_key("ABCDEFGH") != checkin_qr_storage_key("ZYXWVUTS")
    # The raw code is not leaked into the key
    assert "ABCDEFGH" not in key1


def test_generate_returns_none_without_storage() -> None:
    with patch("app.services.checkin_qr.get_storage_service", return_value=None):
        assert generate_checkin_qr_url("ABCDEFGH") is None


def test_generate_uploads_when_missing_and_returns_public_url() -> None:
    storage = MagicMock()
    storage.exists.return_value = False
    storage.get_public_url.return_value = "https://cdn.example.com/checkin-qr/abc.png"

    with patch("app.services.checkin_qr.get_storage_service", return_value=storage):
        url = generate_checkin_qr_url("ABCDEFGH")

    assert url == "https://cdn.example.com/checkin-qr/abc.png"
    storage.upload_bytes.assert_called_once()
    key_arg, content_arg, content_type_arg = storage.upload_bytes.call_args.args
    assert key_arg == checkin_qr_storage_key("ABCDEFGH")
    assert content_arg.startswith(PNG_MAGIC)
    assert content_type_arg == "image/png"


def test_sample_preview_vars_inline_data_uri() -> None:
    sample = sample_checkin_pass_preview_vars()
    assert len(sample["checkin_qrs"]) == 2
    assert sample["checkin_qr_url"].startswith("data:image/png;base64,")
    for qr in sample["checkin_qrs"]:
        assert qr["qr_url"].startswith("data:image/png;base64,")
        assert qr["attendee_name"]
        assert qr["product_name"]


def test_generate_is_idempotent_when_object_exists() -> None:
    storage = MagicMock()
    storage.exists.return_value = True
    storage.get_public_url.return_value = "https://cdn.example.com/checkin-qr/abc.png"

    with patch("app.services.checkin_qr.get_storage_service", return_value=storage):
        url = generate_checkin_qr_url("ABCDEFGH")

    assert url == "https://cdn.example.com/checkin-qr/abc.png"
    storage.upload_bytes.assert_not_called()
