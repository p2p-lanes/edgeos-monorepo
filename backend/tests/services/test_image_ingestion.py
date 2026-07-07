"""Unit tests for app.services.image_ingestion — SSRF, idempotency, fail-open.

Coverage (Slice 1 — no write-path wiring):
  - _resolve_and_validate: all forbidden IP classes + multi-IP rejection
  - PinnedIPTransport: rewrites URL to pinned IP; sets Host + sni_hostname; never calls getaddrinfo
  - DNS-rebinding protection: getaddrinfo called exactly once (pre-flight); transport pinned
  - fetch_image: non-https scheme, non-image CT, oversized body, timeout, redirect loop
  - ImageIngestionService.ingest_url: CDN idempotency, http scheme, storage-disabled no-op,
      SSRF fail-open (all IP classes via parametrize), happy path (upload called once)
  - ImageIngestionService.ingest_html: single img, multi-img (CDN untouched), entity-encoded &amp;
  - ImageIngestionService.ingest_template_config: gallery / rich_text / ticket_select dispatch,
      per-item fail isolation
  - _cdn_hosts, _ext_from_content_type helpers
"""

from __future__ import annotations

import asyncio
import socket
import uuid
from socket import AF_INET, AF_INET6, IPPROTO_TCP, SOCK_STREAM
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

# All imports reference code that does NOT exist yet → RED phase.
from app.services.image_ingestion import (
    MAX_FILE_SIZE_BYTES,
    ImageIngestionService,
    IngestionError,
    PinnedIPTransport,
    _cdn_hosts,
    _ext_from_content_type,
    _read_capped,
    _resolve_and_validate,
    fetch_image,
)

# ─────────────────────────── shared helpers ───────────────────────────────────

TENANT_ID = uuid.uuid4()
EXTERNAL_URL = "https://external.example.com/photo.jpg"


def _gai(ip: str, *, family: int = AF_INET) -> list:
    """Minimal getaddrinfo return value for a given IP address."""
    return [(family, SOCK_STREAM, IPPROTO_TCP, "", (ip, 0))]


def _mock_storage(cdn_base: str = "https://cdn.example.com") -> MagicMock:
    storage = MagicMock()
    storage.get_public_url.side_effect = lambda key: f"{cdn_base}/{key}"
    return storage


# ═══════════════════════════════════════════════════════════════════════════════
# _resolve_and_validate
# ═══════════════════════════════════════════════════════════════════════════════


def test_resolve_private_rfc1918_rejected() -> None:
    """RFC-1918 private addresses must raise IngestionError."""
    with patch("socket.getaddrinfo", return_value=_gai("10.0.0.1")):
        with pytest.raises(IngestionError, match="not routable"):
            _resolve_and_validate("evil.example.com")


def test_resolve_loopback_rejected() -> None:
    with patch("socket.getaddrinfo", return_value=_gai("127.0.0.1")):
        with pytest.raises(IngestionError, match="not routable"):
            _resolve_and_validate("localhost")


def test_resolve_link_local_rejected() -> None:
    with patch("socket.getaddrinfo", return_value=_gai("169.254.169.254")):
        with pytest.raises(IngestionError, match="not routable"):
            _resolve_and_validate("metadata.google.internal")


def test_resolve_multicast_rejected() -> None:
    with patch("socket.getaddrinfo", return_value=_gai("224.0.0.1")):
        with pytest.raises(IngestionError, match="not routable"):
            _resolve_and_validate("multicast.example.com")


def test_resolve_unspecified_ipv4_rejected() -> None:
    """0.0.0.0 is not caught by is_private/is_loopback on py3.12 — is_unspecified covers it."""
    with patch("socket.getaddrinfo", return_value=_gai("0.0.0.0")):
        with pytest.raises(IngestionError, match="not routable"):
            _resolve_and_validate("zero.example.com")


def test_resolve_unspecified_ipv6_rejected() -> None:
    """:: (IPv6 unspecified) must be rejected."""
    with patch("socket.getaddrinfo", return_value=_gai("::", family=AF_INET6)):
        with pytest.raises(IngestionError, match="not routable"):
            _resolve_and_validate("zero6.example.com")


def test_resolve_ipv6_loopback_rejected() -> None:
    """[::1] loopback via IPv6."""
    with patch("socket.getaddrinfo", return_value=_gai("::1", family=AF_INET6)):
        with pytest.raises(IngestionError, match="not routable"):
            _resolve_and_validate("::1")


def test_resolve_ipv4_mapped_ipv6_loopback_rejected() -> None:
    """::ffff:127.0.0.1 normalises to IPv4 127.0.0.1 → loopback → rejected."""
    with patch(
        "socket.getaddrinfo", return_value=_gai("::ffff:127.0.0.1", family=AF_INET6)
    ):
        with pytest.raises(IngestionError, match="not routable"):
            _resolve_and_validate("::ffff:127.0.0.1")


def test_resolve_decimal_ip_rejected() -> None:
    """Decimal form 2130706433 = 127.0.0.1 — getaddrinfo resolves it on Linux."""
    with patch("socket.getaddrinfo", return_value=_gai("127.0.0.1")):
        with pytest.raises(IngestionError, match="not routable"):
            _resolve_and_validate("2130706433")


def test_resolve_octal_ip_rejected() -> None:
    """Octal form 0177.0.0.1 = 127.0.0.1 — getaddrinfo resolves it on Linux."""
    with patch("socket.getaddrinfo", return_value=_gai("127.0.0.1")):
        with pytest.raises(IngestionError, match="not routable"):
            _resolve_and_validate("0177.0.0.1")


def test_resolve_any_ip_private_in_multi_answer_rejects_all() -> None:
    """If ANY returned IP is forbidden the whole resolution is rejected."""
    results = [
        (AF_INET, SOCK_STREAM, IPPROTO_TCP, "", ("93.184.216.34", 0)),  # public
        (AF_INET, SOCK_STREAM, IPPROTO_TCP, "", ("10.0.0.1", 0)),  # private
    ]
    with patch("socket.getaddrinfo", return_value=results):
        with pytest.raises(IngestionError, match="not routable"):
            _resolve_and_validate("mixed.example.com")


def test_resolve_dns_failure_raises_ingestion_error() -> None:
    with patch("socket.getaddrinfo", side_effect=socket.gaierror("no such host")):
        with pytest.raises(IngestionError, match="DNS resolution failed"):
            _resolve_and_validate("nonexistent.invalid")


def test_resolve_public_ip_returns_first_validated() -> None:
    """A public IP passes and is returned as the pinned address."""
    with patch("socket.getaddrinfo", return_value=_gai("93.184.216.34")):
        ip = _resolve_and_validate("example.com")
    assert ip == "93.184.216.34"


# ═══════════════════════════════════════════════════════════════════════════════
# PinnedIPTransport
# ═══════════════════════════════════════════════════════════════════════════════


def test_pinned_transport_does_not_call_getaddrinfo() -> None:
    """PinnedIPTransport must never call getaddrinfo — caller pre-validates."""
    with patch("socket.getaddrinfo") as mock_gai:
        _ = PinnedIPTransport("example.com", "93.184.216.34")
    assert not mock_gai.called


def test_pinned_transport_rewrites_url_to_ip() -> None:
    """handle_async_request forwards the request to the pinned IP, not the hostname."""
    captured: list[httpx.Request] = []

    # Patching at class level: Python passes (self, request) to the replacement.
    async def fake_parent(_self: Any, request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200, content=b"img", headers={"content-type": "image/jpeg"}
        )

    transport = PinnedIPTransport("example.com", "93.184.216.34")
    with patch.object(
        httpx.AsyncHTTPTransport, "handle_async_request", new=fake_parent
    ):
        asyncio.run(
            transport.handle_async_request(
                httpx.Request("GET", "https://example.com/img.jpg")
            )
        )

    assert len(captured) == 1
    assert captured[0].url.host == "93.184.216.34"


def test_pinned_transport_sets_host_header_to_original() -> None:
    captured: list[httpx.Request] = []

    async def fake_parent(_self: Any, request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200, content=b"img", headers={"content-type": "image/jpeg"}
        )

    transport = PinnedIPTransport("example.com", "93.184.216.34")
    with patch.object(
        httpx.AsyncHTTPTransport, "handle_async_request", new=fake_parent
    ):
        asyncio.run(
            transport.handle_async_request(
                httpx.Request("GET", "https://example.com/img.jpg")
            )
        )

    assert captured[0].headers.get("host") == "example.com"


def test_pinned_transport_sets_sni_hostname_extension() -> None:
    """sni_hostname extension must equal original hostname bytes for correct TLS."""
    captured: list[httpx.Request] = []

    async def fake_parent(_self: Any, request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200, content=b"img", headers={"content-type": "image/jpeg"}
        )

    transport = PinnedIPTransport("example.com", "93.184.216.34")
    with patch.object(
        httpx.AsyncHTTPTransport, "handle_async_request", new=fake_parent
    ):
        asyncio.run(
            transport.handle_async_request(
                httpx.Request("GET", "https://example.com/img.jpg")
            )
        )

    assert captured[0].extensions.get("sni_hostname") == b"example.com"


# ═══════════════════════════════════════════════════════════════════════════════
# DNS-rebinding protection
# ═══════════════════════════════════════════════════════════════════════════════


def test_dns_rebinding_getaddrinfo_called_once_not_at_transport_time() -> None:
    """Pre-flight resolution happens exactly once; PinnedIPTransport never re-resolves."""
    call_log: list[str] = []

    def tracking_gai(host: str, *_args: Any, **_kwargs: Any) -> list:
        call_log.append(host)
        return _gai("93.184.216.34")

    # Phase 1: resolve and validate → one getaddrinfo call
    with patch("socket.getaddrinfo", side_effect=tracking_gai):
        ip = _resolve_and_validate("example.com")

    assert len(call_log) == 1
    assert ip == "93.184.216.34"

    # Phase 2: DNS "rebinds" to private IP, but PinnedIPTransport is built without calling getaddrinfo
    with patch("socket.getaddrinfo", return_value=_gai("10.0.0.1")) as mock_rebind:
        transport = PinnedIPTransport("example.com", ip)

    mock_rebind.assert_not_called()
    assert transport._pinned_ip == "93.184.216.34"  # pinned to the public IP


# ═══════════════════════════════════════════════════════════════════════════════
# fetch_image
# ═══════════════════════════════════════════════════════════════════════════════


def test_fetch_image_rejects_http_scheme() -> None:
    """Non-https scheme raises IngestionError without any network activity."""
    with pytest.raises(IngestionError, match="Non-https"):
        asyncio.run(fetch_image("http://example.com/img.jpg"))


def test_fetch_image_rejects_non_image_content_type() -> None:
    async def _run() -> None:
        fake_resp = httpx.Response(
            200, content=b"<html>", headers={"content-type": "text/html"}
        )
        with patch(
            "app.services.image_ingestion._fetch_http",
            return_value=(fake_resp, b"<html>"),
        ):
            with patch(
                "app.services.image_ingestion._resolve_and_validate",
                return_value="93.184.216.34",
            ):
                await fetch_image("https://evil.example.com/page")

    with pytest.raises(IngestionError, match="Disallowed content type"):
        asyncio.run(_run())


def test_fetch_image_rejects_svg_content_type() -> None:
    """SVG is script-capable and must be rejected, not re-hosted (stored XSS)."""

    async def _run() -> None:
        svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'
        fake_resp = httpx.Response(
            200, content=svg, headers={"content-type": "image/svg+xml"}
        )
        with patch(
            "app.services.image_ingestion._fetch_http",
            return_value=(fake_resp, svg),
        ):
            with patch(
                "app.services.image_ingestion._resolve_and_validate",
                return_value="93.184.216.34",
            ):
                await fetch_image("https://evil.example.com/x.svg")

    with pytest.raises(IngestionError, match="Disallowed content type"):
        asyncio.run(_run())


def test_read_capped_aborts_oversized_body() -> None:
    """_read_capped stops streaming once the running total crosses the cap,
    exercising the REAL streaming abort (not a post-download check)."""
    oversized = b"x" * (MAX_FILE_SIZE_BYTES + 1)
    resp = httpx.Response(
        200, content=oversized, headers={"content-type": "image/jpeg"}
    )
    with pytest.raises(IngestionError, match="size limit"):
        asyncio.run(_read_capped(resp))


def test_fetch_image_rejects_timeout() -> None:
    async def _run() -> None:
        async def slow_http(
            _url: str, _pinned_ip: str, _original_host: str
        ) -> tuple[httpx.Response, bytes | None]:
            raise httpx.TimeoutException("timed out")

        with patch("app.services.image_ingestion._fetch_http", side_effect=slow_http):
            with patch(
                "app.services.image_ingestion._resolve_and_validate",
                return_value="93.184.216.34",
            ):
                await fetch_image("https://slow.example.com/img.jpg")

    with pytest.raises(IngestionError, match="[Tt]imeout"):
        asyncio.run(_run())


def test_fetch_image_total_budget_exceeded() -> None:
    """A body that reads slower than the total budget raises, even when each
    individual read stays under the per-read timeout (Slowloris)."""

    async def _run() -> None:
        async def hang(
            _url: str, _pinned_ip: str, _original_host: str
        ) -> tuple[httpx.Response, bytes | None]:
            await asyncio.sleep(3600)
            raise AssertionError("unreachable")

        with patch("app.services.image_ingestion.TOTAL_FETCH_BUDGET", 0.05):
            with patch("app.services.image_ingestion._fetch_http", side_effect=hang):
                with patch(
                    "app.services.image_ingestion._resolve_and_validate",
                    return_value="93.184.216.34",
                ):
                    await fetch_image("https://slow.example.com/img.jpg")

    with pytest.raises(IngestionError, match="budget"):
        asyncio.run(_run())


def test_fetch_image_redirect_hop_to_private_ip_rejected() -> None:
    """Location redirect to a private-IP host is rejected when re-validated."""

    async def _run() -> None:
        redirect_resp = httpx.Response(
            302, headers={"location": "https://internal.example.com/img.jpg"}
        )

        def mock_resolve(host: str) -> str:
            if host == "external.example.com":
                return "93.184.216.34"
            raise IngestionError(f"Resolved IP 10.0.0.1 for {host!r} is not routable")

        with patch(
            "app.services.image_ingestion._resolve_and_validate",
            side_effect=mock_resolve,
        ):
            with patch(
                "app.services.image_ingestion._fetch_http",
                return_value=(redirect_resp, None),
            ):
                await fetch_image("https://external.example.com/img.jpg")

    with pytest.raises(IngestionError, match="not routable"):
        asyncio.run(_run())


def test_fetch_image_redirect_limit_exceeded() -> None:
    """Infinite redirect loop raises after MAX_REDIRECTS hops."""

    async def _run() -> None:
        redirect_resp = httpx.Response(
            302,
            headers={"location": "https://external.example.com/img.jpg"},
        )
        with patch(
            "app.services.image_ingestion._resolve_and_validate",
            return_value="93.184.216.34",
        ):
            with patch(
                "app.services.image_ingestion._fetch_http",
                return_value=(redirect_resp, None),
            ):
                await fetch_image("https://external.example.com/img.jpg")

    with pytest.raises(IngestionError, match="[Tt]oo many redirects|[Rr]edirect limit"):
        asyncio.run(_run())


def test_fetch_image_happy_path() -> None:
    """fetch_image returns (bytes, content_type) for a valid https image."""
    image_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64

    async def _run() -> tuple[bytes, str]:
        fake_resp = httpx.Response(
            200, content=image_bytes, headers={"content-type": "image/png"}
        )
        with patch(
            "app.services.image_ingestion._resolve_and_validate",
            return_value="93.184.216.34",
        ):
            with patch(
                "app.services.image_ingestion._fetch_http",
                return_value=(fake_resp, image_bytes),
            ):
                return await fetch_image("https://example.com/img.png")

    content, ct = asyncio.run(_run())
    assert content == image_bytes
    assert ct == "image/png"


# ═══════════════════════════════════════════════════════════════════════════════
# ImageIngestionService.ingest_url
# ═══════════════════════════════════════════════════════════════════════════════


def test_ingest_url_none_returns_none() -> None:
    svc = ImageIngestionService()
    result = asyncio.run(svc.ingest_url(None, TENANT_ID))
    assert result is None


def test_ingest_url_http_scheme_returns_original_no_fetch() -> None:
    """http:// URL is returned unchanged without any network call."""
    svc = ImageIngestionService()
    with patch("app.services.image_ingestion.fetch_image") as mock_fetch:
        result = asyncio.run(svc.ingest_url("http://example.com/img.jpg", TENANT_ID))
    assert result == "http://example.com/img.jpg"
    mock_fetch.assert_not_called()


def test_ingest_url_storage_disabled_returns_original() -> None:
    """When storage is not configured ingest_url is a no-op."""
    svc = ImageIngestionService()
    with patch("app.services.image_ingestion.get_storage_service", return_value=None):
        with patch("app.services.image_ingestion.fetch_image") as mock_fetch:
            result = asyncio.run(svc.ingest_url(EXTERNAL_URL, TENANT_ID))
    assert result == EXTERNAL_URL
    mock_fetch.assert_not_called()


def test_ingest_url_cdn_host_returns_original_no_fetch() -> None:
    """URL whose host matches STORAGE_PUBLIC_URL is returned unchanged — no network call."""
    from app.core.config import settings

    cdn_url = "https://cdn.example.com/tenant/images/abc.jpg"
    svc = ImageIngestionService()
    with patch.object(settings, "STORAGE_PUBLIC_URL", "https://cdn.example.com"):
        with patch.object(settings, "STORAGE_ENDPOINT_URL", None):
            with patch("app.services.image_ingestion.get_storage_service") as mock_ss:
                mock_ss.return_value = _mock_storage()
                with patch("app.services.image_ingestion.fetch_image") as mock_fetch:
                    result = asyncio.run(svc.ingest_url(cdn_url, TENANT_ID))

    assert result == cdn_url
    mock_fetch.assert_not_called()


def test_ingest_url_happy_path_returns_cdn_url() -> None:
    """External https image: fetch → upload → return CDN URL."""
    from app.core.config import settings

    image_bytes = b"\xff\xd8\xff\xe0" + b"\x00" * 100
    mock_store = _mock_storage()

    async def _run() -> str:
        with patch.object(settings, "STORAGE_PUBLIC_URL", None):
            with patch.object(settings, "STORAGE_ENDPOINT_URL", None):
                with patch(
                    "app.services.image_ingestion.fetch_image",
                    new=AsyncMock(return_value=(image_bytes, "image/jpeg")),
                ):
                    with patch(
                        "app.services.image_ingestion.get_storage_service",
                        return_value=mock_store,
                    ):
                        svc = ImageIngestionService()
                        return await svc.ingest_url(EXTERNAL_URL, TENANT_ID)

    result = asyncio.run(_run())
    assert result.startswith("https://cdn.example.com/")
    assert result.endswith(".jpg")
    mock_store.upload_bytes.assert_called_once()
    upload_key, upload_content, upload_ct = mock_store.upload_bytes.call_args[0]
    assert upload_key.startswith(f"{TENANT_ID}/images/")
    assert upload_key.endswith(".jpg")
    assert upload_content == image_bytes
    assert upload_ct == "image/jpeg"


def test_ingest_url_upload_called_exactly_once() -> None:
    """storage.upload_bytes is called exactly once per successful ingest (no double-upload)."""
    from app.core.config import settings

    mock_store = _mock_storage()

    async def _run() -> str:
        with patch.object(settings, "STORAGE_PUBLIC_URL", None):
            with patch.object(settings, "STORAGE_ENDPOINT_URL", None):
                with patch(
                    "app.services.image_ingestion.fetch_image",
                    new=AsyncMock(return_value=(b"data", "image/png")),
                ):
                    with patch(
                        "app.services.image_ingestion.get_storage_service",
                        return_value=mock_store,
                    ):
                        svc = ImageIngestionService()
                        return await svc.ingest_url(EXTERNAL_URL, TENANT_ID)

    asyncio.run(_run())
    mock_store.upload_bytes.assert_called_once()


# ─────────────────── SSRF → fail-open via ingest_url ─────────────────────────


@pytest.mark.parametrize(
    "bad_ip,family",
    [
        ("10.0.0.1", AF_INET),
        ("127.0.0.1", AF_INET),
        ("169.254.169.254", AF_INET),
        ("224.0.0.1", AF_INET),
        ("0.0.0.0", AF_INET),
        ("::", AF_INET6),
        ("::1", AF_INET6),
        ("::ffff:127.0.0.1", AF_INET6),
    ],
)
def test_ingest_url_ssrf_rejected_fail_open(bad_ip: str, family: int) -> None:
    """All bad IPs → fail-open → original URL returned, no exception raised."""
    from app.core.config import settings

    with patch.object(settings, "STORAGE_PUBLIC_URL", None):
        with patch.object(settings, "STORAGE_ENDPOINT_URL", None):
            with patch(
                "app.services.image_ingestion.get_storage_service",
                return_value=_mock_storage(),
            ):
                with patch(
                    "socket.getaddrinfo", return_value=_gai(bad_ip, family=family)
                ):
                    svc = ImageIngestionService()
                    result = asyncio.run(svc.ingest_url(EXTERNAL_URL, TENANT_ID))

    assert result == EXTERNAL_URL


def test_ingest_url_ssrf_decimal_form_fail_open() -> None:
    """Decimal form 2130706433 resolves to 127.0.0.1 → fail-open."""
    from app.core.config import settings

    url = "https://2130706433/img.jpg"
    with patch.object(settings, "STORAGE_PUBLIC_URL", None):
        with patch.object(settings, "STORAGE_ENDPOINT_URL", None):
            with patch(
                "app.services.image_ingestion.get_storage_service",
                return_value=_mock_storage(),
            ):
                with patch("socket.getaddrinfo", return_value=_gai("127.0.0.1")):
                    svc = ImageIngestionService()
                    result = asyncio.run(svc.ingest_url(url, TENANT_ID))

    assert result == url


def test_ingest_url_ssrf_octal_form_fail_open() -> None:
    """Octal form 0177.0.0.1 resolves to 127.0.0.1 → fail-open."""
    from app.core.config import settings

    url = "https://0177.0.0.1/img.jpg"
    with patch.object(settings, "STORAGE_PUBLIC_URL", None):
        with patch.object(settings, "STORAGE_ENDPOINT_URL", None):
            with patch(
                "app.services.image_ingestion.get_storage_service",
                return_value=_mock_storage(),
            ):
                with patch("socket.getaddrinfo", return_value=_gai("127.0.0.1")):
                    svc = ImageIngestionService()
                    result = asyncio.run(svc.ingest_url(url, TENANT_ID))

    assert result == url


# ═══════════════════════════════════════════════════════════════════════════════
# ImageIngestionService.ingest_html
# ═══════════════════════════════════════════════════════════════════════════════


def test_ingest_html_single_external_img_replaced() -> None:
    """Single external <img src> is rewritten to the CDN URL; surrounding markup unchanged."""
    html = (
        '<p>Hello <img src="https://external.example.com/photo.jpg" alt="x"> world</p>'
    )
    cdn = "https://cdn.example.com/tenant/images/new.jpg"

    async def _run() -> str:
        svc = ImageIngestionService()
        with patch.object(svc, "ingest_url", new=AsyncMock(return_value=cdn)):
            return await svc.ingest_html(html, TENANT_ID)

    result = asyncio.run(_run())
    assert cdn in result
    assert "external.example.com" not in result
    assert "<p>Hello" in result
    assert "world</p>" in result


def test_ingest_html_cdn_img_untouched() -> None:
    """CDN <img> is left unchanged; other external imgs are replaced."""
    cdn_existing = "https://cdn.example.com/old.jpg"
    external = "https://other.example.com/img.jpg"
    html = f'<img src="{cdn_existing}"><img src="{external}">'
    new_cdn = "https://cdn.example.com/new.jpg"

    async def _run() -> str:
        svc = ImageIngestionService()

        def fake_ingest(url: str, _tenant_id: uuid.UUID) -> str:
            return url if "cdn.example.com" in url else new_cdn

        with patch.object(svc, "ingest_url", new=AsyncMock(side_effect=fake_ingest)):
            return await svc.ingest_html(html, TENANT_ID)

    result = asyncio.run(_run())
    assert cdn_existing in result  # CDN img unchanged
    assert new_cdn in result  # external replaced


def test_ingest_html_entity_encoded_src_replaced() -> None:
    """Regression: &amp;-encoded query params in src must be rewritten to CDN URL.

    html.parser decodes &amp; → &b=2 for the network fetch (decoded URL),
    but replacement must target the raw &amp; form in the HTML string.
    """
    html = '<img src="https://host/i?a=1&amp;b=2">'
    cdn = "https://cdn.example.com/new.jpg"

    async def _run() -> str:
        svc = ImageIngestionService()

        async def fake_ingest(url: str, _tenant_id: uuid.UUID) -> str:
            # Must receive the DECODED url (a=1&b=2, not a=1&amp;b=2)
            assert "&amp;" not in url, (
                f"ingest_url received entity-encoded URL: {url!r}"
            )
            return cdn

        with patch.object(svc, "ingest_url", new=AsyncMock(side_effect=fake_ingest)):
            return await svc.ingest_html(html, TENANT_ID)

    result = asyncio.run(_run())
    assert cdn in result
    # The raw &amp; form no longer appears in the HTML
    assert "host/i?a=1" not in result


# ═══════════════════════════════════════════════════════════════════════════════
# ImageIngestionService.ingest_template_config
# ═══════════════════════════════════════════════════════════════════════════════


def test_ingest_template_config_gallery_replaces_images() -> None:
    cdn_a = "https://cdn.example.com/a.jpg"
    cdn_b = "https://cdn.example.com/b.jpg"

    async def _run() -> dict:
        svc = ImageIngestionService()
        with patch.object(
            svc, "ingest_urls", new=AsyncMock(return_value=[cdn_a, cdn_b])
        ):
            return await svc.ingest_template_config(
                "gallery",
                {"images": ["https://ext.com/a.jpg", "https://ext.com/b.jpg"]},
                TENANT_ID,
            )

    result = asyncio.run(_run())
    assert result is not None
    assert result["images"] == [cdn_a, cdn_b]


def test_ingest_template_config_rich_text_rewrites_html() -> None:
    original_html = '<img src="https://ext.com/img.jpg">'
    new_html = '<img src="https://cdn.example.com/new.jpg">'

    async def _run() -> dict:
        svc = ImageIngestionService()
        with patch.object(svc, "ingest_html", new=AsyncMock(return_value=new_html)):
            return await svc.ingest_template_config(
                "rich_text",
                {"html": original_html},
                TENANT_ID,
            )

    result = asyncio.run(_run())
    assert result is not None
    assert result["html"] == new_html


def test_ingest_template_config_ticket_select_replaces_section_image_url() -> None:
    cdn_url = "https://cdn.example.com/section.jpg"

    async def _run() -> dict:
        svc = ImageIngestionService()

        async def fake_ingest(_url: str, _tenant_id: uuid.UUID) -> str:
            return cdn_url

        with patch.object(svc, "ingest_url", new=AsyncMock(side_effect=fake_ingest)):
            return await svc.ingest_template_config(
                "ticket_select",
                {
                    "sections": [
                        {"image_url": "https://ext.com/img.jpg", "label": "VIP"}
                    ]
                },
                TENANT_ID,
            )

    result = asyncio.run(_run())
    assert result is not None
    assert result["sections"][0]["image_url"] == cdn_url
    assert result["sections"][0]["label"] == "VIP"  # non-image fields preserved


def test_ingest_template_config_per_item_fail_isolation() -> None:
    """One URL that fails open keeps original; rest succeed."""

    async def _run() -> dict:
        svc = ImageIngestionService()
        cdn_a = "https://cdn.example.com/a.jpg"
        original_b = "https://ext.com/b.jpg"

        async def fake_ingest_urls(urls: list[str], _tenant_id: uuid.UUID) -> list[str]:
            return [
                cdn_a if "a.jpg" in u else u  # b.jpg fails open → original
                for u in urls
            ]

        with patch.object(
            svc, "ingest_urls", new=AsyncMock(side_effect=fake_ingest_urls)
        ):
            return await svc.ingest_template_config(
                "gallery",
                {"images": ["https://ext.com/a.jpg", original_b]},
                TENANT_ID,
            )

    result = asyncio.run(_run())
    assert result is not None
    assert result["images"][0] == "https://cdn.example.com/a.jpg"
    assert result["images"][1] == "https://ext.com/b.jpg"


def test_ingest_template_config_none_config_returns_none() -> None:
    """None config is passed through unchanged."""
    svc = ImageIngestionService()
    result = asyncio.run(svc.ingest_template_config("gallery", None, TENANT_ID))
    assert result is None


# ═══════════════════════════════════════════════════════════════════════════════
# ingest_urls
# ═══════════════════════════════════════════════════════════════════════════════


def test_ingest_urls_returns_list_of_cdn_urls() -> None:
    cdn_results = ["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg"]
    original_urls = ["https://ext.com/1.jpg", "https://ext.com/2.jpg"]

    async def _run() -> list[str]:
        svc = ImageIngestionService()
        with patch.object(svc, "ingest_url", new=AsyncMock(side_effect=cdn_results)):
            return await svc.ingest_urls(original_urls, TENANT_ID)

    result = asyncio.run(_run())
    assert result == cdn_results


# ═══════════════════════════════════════════════════════════════════════════════
# _cdn_hosts helper
# ═══════════════════════════════════════════════════════════════════════════════


def test_cdn_hosts_includes_both_public_and_endpoint_hosts() -> None:
    from app.core.config import settings

    with patch.object(settings, "STORAGE_PUBLIC_URL", "https://cdn.example.com"):
        with patch.object(settings, "STORAGE_ENDPOINT_URL", "https://s3.example.com"):
            hosts = _cdn_hosts()

    assert "cdn.example.com" in hosts
    assert "s3.example.com" in hosts


def test_cdn_hosts_without_public_url_uses_endpoint_only() -> None:
    from app.core.config import settings

    with patch.object(settings, "STORAGE_PUBLIC_URL", None):
        with patch.object(
            settings, "STORAGE_ENDPOINT_URL", "https://minio.internal:9000"
        ):
            hosts = _cdn_hosts()

    assert "minio.internal" in hosts
    assert len(hosts) == 1


def test_cdn_hosts_unconfigured_returns_empty_set() -> None:
    from app.core.config import settings

    with patch.object(settings, "STORAGE_PUBLIC_URL", None):
        with patch.object(settings, "STORAGE_ENDPOINT_URL", None):
            hosts = _cdn_hosts()

    assert len(hosts) == 0


# ═══════════════════════════════════════════════════════════════════════════════
# _ext_from_content_type helper
# ═══════════════════════════════════════════════════════════════════════════════


def test_ext_jpeg() -> None:
    assert _ext_from_content_type("image/jpeg") == "jpg"


def test_ext_png() -> None:
    assert _ext_from_content_type("image/png") == "png"


def test_ext_webp() -> None:
    assert _ext_from_content_type("image/webp") == "webp"


def test_ext_gif() -> None:
    assert _ext_from_content_type("image/gif") == "gif"


def test_svg_not_in_allowed_content_types() -> None:
    """SVG must never be an ingestible type (script-capable → stored XSS)."""
    from app.services.image_ingestion import _ALLOWED_CONTENT_TYPES

    assert "image/svg+xml" not in _ALLOWED_CONTENT_TYPES


def test_ext_unknown_falls_back_to_non_empty_string() -> None:
    ext = _ext_from_content_type("image/tiff")
    assert isinstance(ext, str)
    assert len(ext) > 0
