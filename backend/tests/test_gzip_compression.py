"""Tests for gzip response compression (GZipMiddleware).

The API previously sent every response uncompressed; large, repetitive
JSON/ICS payloads (e.g. a popup's ~310 KB public calendar feed) dominated
page-load time on slow connections. GZipMiddleware compresses responses for
clients that advertise gzip, skipping tiny payloads via ``minimum_size``.

The behavioural tests build a minimal app with the same config (so they don't
need the Docker-backed DB fixtures); a final test asserts the real application
wires the middleware with RequestContextMiddleware still outermost.
"""

from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from starlette.middleware.gzip import GZipMiddleware
from starlette.testclient import TestClient

MIN_SIZE = 1000


def _app() -> FastAPI:
    app = FastAPI()
    app.add_middleware(GZipMiddleware, minimum_size=MIN_SIZE)

    @app.get("/big")
    def big() -> PlainTextResponse:
        return PlainTextResponse("x" * 5000)

    @app.get("/small")
    def small() -> PlainTextResponse:
        return PlainTextResponse("tiny")

    return app


def test_large_response_is_gzipped() -> None:
    client = TestClient(_app())
    r = client.get("/big", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") == "gzip"
    assert "accept-encoding" in r.headers.get("vary", "").lower()
    # httpx transparently decodes, so the body is intact.
    assert r.text == "x" * 5000


def test_large_response_body_is_actually_gzip_on_the_wire() -> None:
    """Stronger proof: the raw bytes are gzip-compressed (magic 1f 8b), not just
    a header httpx might preserve, and decompress back to the original."""
    import gzip

    client = TestClient(_app())
    with client.stream("GET", "/big", headers={"Accept-Encoding": "gzip"}) as r:
        raw = b"".join(r.iter_raw())
    assert raw[:2] == b"\x1f\x8b"  # gzip magic bytes
    assert len(raw) < 5000  # actually smaller than the plaintext
    assert gzip.decompress(raw) == b"x" * 5000


def test_small_response_not_gzipped() -> None:
    client = TestClient(_app())
    r = client.get("/small", headers={"Accept-Encoding": "gzip"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") != "gzip"


def test_client_without_gzip_gets_plain_response() -> None:
    client = TestClient(_app())
    r = client.get("/big", headers={"Accept-Encoding": "identity"})
    assert r.status_code == 200
    assert r.headers.get("content-encoding") != "gzip"
    assert r.text == "x" * 5000


def test_real_app_wires_gzip_inside_request_context() -> None:
    from app.core.logging import RequestContextMiddleware
    from app.main import application

    classes = [m.cls for m in application.user_middleware]
    assert GZipMiddleware in classes, "GZipMiddleware not registered"
    # Starlette inserts each add_middleware() at index 0, so user_middleware[0]
    # is the outermost. RequestContextMiddleware must stay outermost (it logs
    # every request), with GZip nested inside it.
    assert classes[0] is RequestContextMiddleware
    assert classes.index(GZipMiddleware) > classes.index(RequestContextMiddleware)
