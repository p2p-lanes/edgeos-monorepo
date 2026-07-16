"""SSRF-safe image download and CDN re-upload service.

Only Slice 1 is implemented here: the service core + SSRF-safe fetcher.
Write-path wiring (ticketing_step, popup, tenant, product) is Slice 2+.

Design ref: sdd/cdn-image-ingestion/design (rev 2 — gate remediation)
"""

from __future__ import annotations

import asyncio
import ipaddress
import mimetypes
import re
import socket
import time
import uuid
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urlparse

import httpx
from loguru import logger

from app.core.config import settings
from app.services.storage import MAX_FILE_SIZE_BYTES, get_storage_service

# ─────────────────────────── constants ───────────────────────────────────────

MAX_REDIRECTS: int = 3
CONNECT_TIMEOUT: float = 5.0  # seconds
READ_TIMEOUT: float = 10.0  # seconds (per socket read operation)
# Wall-clock ceiling for the entire body download. httpx's read timeout is
# per-read-operation, so a server dribbling one byte just under READ_TIMEOUT
# forever (Slowloris) never trips it. This total budget bounds that.
TOTAL_FETCH_BUDGET: float = 20.0  # seconds

# Explicit extension map — avoids platform-dependent mimetypes output.
# SVG is deliberately EXCLUDED: it can carry <script> and, served from the
# CDN origin, becomes stored XSS. We never re-host SVGs.
_MIME_TO_EXT: dict[str, str] = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
}

# Content types accepted for ingestion. A raster allowlist, not "image/*":
# image/svg+xml is script-capable and is intentionally absent.
_ALLOWED_CONTENT_TYPES: frozenset[str] = frozenset(_MIME_TO_EXT)

# ─────────────────────────── exception ───────────────────────────────────────


class IngestionError(Exception):
    """Raised internally by fetch_image / SSRF validation.

    Caught by ImageIngestionService.ingest_url (fail-open): returns the
    original URL unchanged instead of propagating to the caller.
    """


# ─────────────────────────── SSRF helpers ────────────────────────────────────


def _is_ip_forbidden(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    """Return True if the IP is in a range that should never be fetched."""
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def _resolve_and_validate(host: str) -> str:
    """Resolve *host* via getaddrinfo and reject if ANY returned IP is forbidden.

    Returns the first validated IP string (used by PinnedIPTransport to
    nail the TCP socket so the transport never re-resolves the hostname).

    Raises IngestionError on DNS failure or any forbidden IP.
    """
    try:
        results = socket.getaddrinfo(host, None, proto=socket.IPPROTO_TCP)
    except socket.gaierror as exc:
        raise IngestionError(f"DNS resolution failed for {host!r}: {exc}") from exc

    if not results:
        raise IngestionError(f"No addresses resolved for {host!r}")

    pinned_ip: str | None = None
    for _family, _type, _proto, _canonname, sockaddr in results:
        raw_addr: str = sockaddr[0]
        try:
            ip: ipaddress.IPv4Address | ipaddress.IPv6Address = ipaddress.ip_address(
                raw_addr
            )
        except ValueError:
            continue

        # Normalize IPv4-mapped IPv6 (::ffff:127.0.0.1 → 127.0.0.1) so the
        # embedded v4 address is evaluated by the predicate, not the wrapper.
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
            ip = ip.ipv4_mapped

        if _is_ip_forbidden(ip):
            raise IngestionError(
                f"Resolved IP {ip!s} for {host!r} is not routable (SSRF policy)"
            )

        if pinned_ip is None:
            pinned_ip = raw_addr

    if pinned_ip is None:
        raise IngestionError(f"No valid address found for {host!r}")

    return pinned_ip


# ─────────────────────────── PinnedIPTransport ───────────────────────────────


class PinnedIPTransport(httpx.AsyncHTTPTransport):
    """httpx transport that connects to a pre-validated IP address.

    Prevents DNS-rebinding TOCTOU: the hostname is resolved and validated
    exactly once (by ``_resolve_and_validate``) before this transport is
    created.  The transport then rewrites every request URL to use the
    pinned IP so the underlying httpcore pool dials that exact address
    without any second DNS lookup.

    TLS SNI and the HTTP ``Host`` header still use the original hostname so
    certificate validation and virtual-host routing work correctly.

    FALLBACK approach for httpx 0.28.1 / httpcore 1.0.9:
      1. Rewrite request URL: replace host with *pinned_ip*.
      2. Set ``Host`` header to *original_host*.
      3. Set ``extensions["sni_hostname"]`` to *original_host* bytes so
         httpcore uses it for the TLS handshake instead of the IP.
    """

    def __init__(self, original_host: str, pinned_ip: str, **kwargs: Any) -> None:
        super().__init__(**kwargs)
        self._original_host = original_host
        self._pinned_ip = pinned_ip

    async def handle_async_request(self, request: httpx.Request) -> httpx.Response:
        # 1. Rewrite the URL host to the pinned IP so httpcore dials that address.
        pinned_url = request.url.copy_with(host=self._pinned_ip)

        # 2. Build headers: drop any existing Host entry and set the original hostname.
        raw_headers: list[tuple[bytes, bytes]] = [
            (name, value)
            for name, value in request.headers.raw
            if name.lower() != b"host"
        ]
        raw_headers.append((b"host", self._original_host.encode("ascii")))

        # 3. Pass sni_hostname so TLS negotiates with the original hostname.
        extensions: dict[str, Any] = {
            **request.extensions,
            "sni_hostname": self._original_host.encode("ascii"),
        }

        pinned_request = httpx.Request(
            method=request.method,
            url=pinned_url,
            headers=raw_headers,
            extensions=extensions,
            stream=request.stream,
        )

        return await super().handle_async_request(pinned_request)


# ─────────────────────────── fetch helpers ───────────────────────────────────


async def _read_capped(response: httpx.Response) -> bytes:
    """Stream a response body, aborting as soon as the size cap is crossed.

    Reads incrementally so an oversized (or Content-Length-lying) body is
    never fully buffered into memory — the connection is dropped the moment
    the running total exceeds the cap.
    """
    chunks: list[bytes] = []
    total = 0
    async for chunk in response.aiter_bytes():
        total += len(chunk)
        if total > MAX_FILE_SIZE_BYTES:
            raise IngestionError(
                f"Response body exceeds size limit of {MAX_FILE_SIZE_BYTES} bytes"
            )
        chunks.append(chunk)
    return b"".join(chunks)


async def _fetch_http(
    url: str,
    pinned_ip: str,
    original_host: str,
) -> tuple[httpx.Response, bytes | None]:
    """Single streamed HTTP GET through PinnedIPTransport.

    Returns ``(response, body)`` where ``body`` is the size-capped bytes for
    a final (non-redirect) response, or ``None`` for a redirect (whose body
    we never read). Streaming keeps an oversized body from being buffered
    before the cap check runs.

    Isolated as a module-level function so unit tests can monkeypatch it
    without real TCP connections.
    """
    transport = PinnedIPTransport(original_host, pinned_ip)
    async with httpx.AsyncClient(
        transport=transport,
        follow_redirects=False,
        timeout=httpx.Timeout(connect=CONNECT_TIMEOUT, read=READ_TIMEOUT),
    ) as client:
        async with client.stream("GET", url) as response:
            if response.is_redirect:
                return response, None
            body = await _read_capped(response)
            return response, body


async def fetch_image(url: str) -> tuple[bytes, str]:
    """Download an image from *url* using the SSRF-safe PinnedIPTransport.

    Validates scheme, DNS (all returned IPs), Content-Type, body size, and
    per-hop redirect re-validation.

    Returns ``(bytes, content_type)`` on success.
    Raises ``IngestionError`` on any validation / download failure.
    """
    if not url.startswith("https://"):
        # Fast path before URL parsing — catches scheme check without httpx overhead.
        parsed_scheme = httpx.URL(url).scheme if "://" in url else url.split(":")[0]
        raise IngestionError(f"Non-https scheme: {parsed_scheme!r}")

    try:
        return await asyncio.wait_for(
            _fetch_image_inner(url), timeout=TOTAL_FETCH_BUDGET
        )
    except TimeoutError as exc:
        # Total wall-clock budget exceeded (Slowloris / slow drip).
        raise IngestionError(
            f"Total fetch budget of {TOTAL_FETCH_BUDGET}s exceeded for {url!r}"
        ) from exc


async def _fetch_image_inner(url: str) -> tuple[bytes, str]:
    """Redirect-following fetch loop, wrapped by fetch_image's total budget."""
    current_url = url

    for hop in range(MAX_REDIRECTS + 1):
        parsed = httpx.URL(current_url)

        if parsed.scheme != "https":
            raise IngestionError(
                f"Redirect to non-https scheme on hop {hop}: {parsed.scheme!r}"
            )

        host = parsed.host
        pinned_ip = _resolve_and_validate(host)

        try:
            response, body = await _fetch_http(current_url, pinned_ip, host)
        except httpx.TimeoutException as exc:
            raise IngestionError(f"Timeout fetching {current_url!r}: {exc}") from exc

        if response.is_redirect:
            if hop >= MAX_REDIRECTS:
                raise IngestionError(
                    f"Too many redirects: limit is {MAX_REDIRECTS} hop(s)"
                )
            location = response.headers.get("location")
            if not location:
                raise IngestionError("Redirect response missing Location header")
            current_url = location
            continue

        # Validate Content-Type against the raster allowlist (SVG excluded).
        raw_ct = response.headers.get("content-type", "")
        content_type = raw_ct.split(";")[0].strip().lower()
        if content_type not in _ALLOWED_CONTENT_TYPES:
            raise IngestionError(f"Disallowed content type: {content_type!r}")

        # body is guaranteed non-None for a non-redirect response.
        assert body is not None
        return body, content_type

    raise IngestionError(f"Redirect limit exceeded ({MAX_REDIRECTS} hops)")


# ─────────────────────────── CDN host set ────────────────────────────────────


def _cdn_hosts() -> frozenset[str]:
    """Derive the set of CDN / storage hostnames from config.

    A URL whose host is in this set is already on the CDN and must be
    returned unchanged (idempotency).  Computed on every call so tests can
    monkeypatch ``settings`` without stale caches.
    """
    hosts: set[str] = set()
    if settings.STORAGE_PUBLIC_URL:
        h = urlparse(settings.STORAGE_PUBLIC_URL).hostname
        if h:
            hosts.add(h)
    if settings.STORAGE_ENDPOINT_URL:
        h = urlparse(settings.STORAGE_ENDPOINT_URL).hostname
        if h:
            hosts.add(h)
    return frozenset(hosts)


# ─────────────────────────── extension helper ────────────────────────────────


def _ext_from_content_type(content_type: str) -> str:
    """Return a file extension (without leading dot) for *content_type*.

    Uses an explicit map for common image types to avoid platform-specific
    mimetypes output (e.g. ``.jpe`` vs ``.jpg``).
    """
    explicit = _MIME_TO_EXT.get(content_type)
    if explicit:
        return explicit
    guessed = mimetypes.guess_extension(content_type)
    if guessed:
        return guessed.lstrip(".")
    return "bin"


# ─────────────────────────── HTML img rewriter ───────────────────────────────


class _HtmlImgRewriter(HTMLParser):
    """Extract ``(decoded_src, raw_src)`` pairs from ``<img>`` tags.

    ``html.parser`` delivers entity-decoded attribute values (e.g. ``&`` for
    ``&amp;``), but the raw HTML holds the encoded form.  We need the RAW
    form for string replacement and the DECODED form for the network fetch.

    Strategy: call ``get_starttag_text()`` to get the verbatim tag source,
    then extract the raw src attribute value via regex.  The decoded value
    comes from ``attrs`` as usual.
    """

    def __init__(self) -> None:
        super().__init__()
        self.pairs: list[tuple[str, str]] = []  # (decoded_url, raw_attr_value)

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "img":
            return
        raw_tag = self.get_starttag_text()
        if raw_tag is None:
            return

        # Decoded src value (entity-decoded by html.parser)
        decoded_src: str | None = None
        for name, value in attrs:
            if name.lower() == "src" and value:
                decoded_src = value
                break
        if decoded_src is None:
            return

        # Extract the RAW src attribute value from the verbatim tag text.
        # This preserves entity-encoded forms like &amp; for safe replacement.
        m = re.search(r"""src\s*=\s*(?:"([^"]*)"|'([^']*)')""", raw_tag, re.IGNORECASE)
        if m:
            raw_value = m.group(1) if m.group(1) is not None else m.group(2)
            self.pairs.append((decoded_src, raw_value))


# ─────────────────────────── service ─────────────────────────────────────────


class ImageIngestionService:
    """Server-side SSRF-safe image download and CDN re-upload service.

    Public API (all fail-open — never raise to caller):
      ingest_url(url, tenant_id) → str | None
      ingest_urls(urls, tenant_id) → list[str]
      ingest_html(html, tenant_id) → str
      ingest_template_config(template, config, tenant_id) → dict | None
    """

    # ------------------------------------------------------------------
    # Core: single URL
    # ------------------------------------------------------------------

    async def ingest_url(
        self,
        url: str | None,
        tenant_id: uuid.UUID,
    ) -> str | None:
        """Ingest a single image URL.

        - None → None passthrough.
        - Non-https scheme → original URL (no network call).
        - Storage not configured → original URL (feature disabled).
        - Host in CDN set → original URL (idempotent).
        - Otherwise: fetch via SSRF-safe transport → upload → return CDN URL.
        - Any failure → original URL + warning log (fail-open).
        """
        if url is None:
            return None

        parsed = urlparse(url)
        if parsed.scheme != "https":
            return url

        storage = get_storage_service()
        if storage is None:
            return url  # Storage not configured — whole feature is a no-op.

        if parsed.hostname in _cdn_hosts():
            return url  # Already on CDN — idempotent.

        start = time.monotonic()
        source_host = parsed.hostname or ""

        try:
            content, content_type = await fetch_image(url)
            elapsed_ms = int((time.monotonic() - start) * 1000)

            ext = _ext_from_content_type(content_type)
            key = f"{tenant_id}/images/{uuid.uuid4()}.{ext}"

            await asyncio.to_thread(storage.upload_bytes, key, content, content_type)
            cdn_url = storage.get_public_url(key)

            logger.info(
                "Image ingested",
                action="ingested",
                source_host=source_host,
                cdn_key=key,
                bytes=len(content),
                elapsed_ms=elapsed_ms,
            )
            return cdn_url

        except IngestionError as exc:
            logger.warning(
                "Image ingestion failed",
                action="failed",
                source_host=source_host,
                reason=str(exc),
            )
            return url
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "Image ingestion unexpected error",
                action="failed",
                source_host=source_host,
                reason=str(exc),
            )
            return url

    # ------------------------------------------------------------------
    # Batch: list of URLs
    # ------------------------------------------------------------------

    async def ingest_urls(
        self,
        urls: list[str],
        tenant_id: uuid.UUID,
    ) -> list[str]:
        """Ingest a list of URLs in parallel (asyncio.gather).

        Per-item failures are fail-open: the original URL is kept for any
        item that errors.  One failure never kills the batch.
        """
        results = await asyncio.gather(
            *[self.ingest_url(u, tenant_id) for u in urls],
            return_exceptions=True,
        )
        return [
            orig if isinstance(res, Exception) else (res if res is not None else orig)
            for orig, res in zip(urls, results, strict=True)
        ]

    # ------------------------------------------------------------------
    # HTML rewrite
    # ------------------------------------------------------------------

    async def ingest_html(
        self,
        html: str,
        tenant_id: uuid.UUID,
    ) -> str:
        """Parse *html*, ingest each ``<img src>`` URL, replace in-place.

        Uses the raw attribute value (from ``get_starttag_text()``) for
        replacement so entity-encoded srcs (``&amp;``) are handled correctly.
        Only replaces when ingestion produced a different (CDN) URL.
        """
        parser = _HtmlImgRewriter()
        parser.feed(html)
        result = html
        for decoded_url, raw_value in parser.pairs:
            new_url = await self.ingest_url(decoded_url, tenant_id)
            # Only replace when we actually got a different (CDN) URL back.
            if new_url and new_url != decoded_url:
                result = result.replace(raw_value, new_url, 1)
        return result

    # ------------------------------------------------------------------
    # Template config walker
    # ------------------------------------------------------------------

    async def ingest_template_config(
        self,
        template: str | None,
        config: dict | None,
        tenant_id: uuid.UUID,
    ) -> dict | None:
        """Ingest image URLs inside a ticketing-step ``template_config`` dict.

        Dispatch by *template* type (real backoffice template names):
          ``image-gallery``            → ``config["images"]`` via ``ingest_urls``
          ``rich-text``                → ``config["html"]`` via ``ingest_html``
          ``ticket-select``/``ticket-card`` → each ``section["image_url"]``
          ``hero``                     → flat ``*_url`` artwork/ornament fields
          other / unknown              → config returned unchanged (safe no-op)

        Returns ``None`` when *config* is ``None``.
        """
        if config is None:
            return None

        if template == "image-gallery":
            images: list[str] = config.get("images") or []
            new_images = await self.ingest_urls(images, tenant_id)
            return {**config, "images": new_images}

        if template == "rich-text":
            html: str = config.get("html") or ""
            new_html = await self.ingest_html(html, tenant_id)
            return {**config, "html": new_html}

        # Both ticket-select and ticket-card carry sections[].image_url cover
        # images (see portal VariantTicketCard / VariantTicketSelect).
        if template in ("ticket-select", "ticket-card"):
            sections: list[dict] = config.get("sections") or []
            new_sections = []
            for section in sections:
                img_url = section.get("image_url")
                new_img_url = await self.ingest_url(img_url, tenant_id)
                new_sections.append({**section, "image_url": new_img_url})
            return {**config, "sections": new_sections}

        # Hero (checkout "home" step) — brand artwork and ornaments, each a
        # flat top-level URL field (see portal VariantHero / backoffice
        # HeroConfig). Missing/empty fields are left alone.
        if template == "hero":
            new_config = {**config}
            for key in (
                "date_logo_url",
                "edition_url",
                "divider_url",
            ):
                url = config.get(key)
                if url:
                    new_config[key] = await self.ingest_url(url, tenant_id)
            return new_config

        # Unknown template type — return unchanged (fail-safe).
        return config
