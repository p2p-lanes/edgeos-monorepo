"""Regression tests for tenant PATCH no-op guards.

Covers:
- Bug 1: guard 4 fired on round-tripped custom_domain even when unchanged
- Bug 2: TenantUpdate.slug caused slug rotation on any name change, and accepted
         explicit slug overrides from the PATCH body

Scenarios align 1:1 with spec sdd/tenant-patch-no-op-guards (Revision 2).
"""

import uuid

from fastapi.testclient import TestClient
from sqlmodel import Session

from app.api.tenant.models import Tenants

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _admin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _superadmin_headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _make_tenant(
    db: Session,
    *,
    suffix: str,
    name: str | None = None,
    slug: str | None = None,
    custom_domain: str | None = None,
    custom_domain_active: bool = False,
) -> Tenants:
    t = Tenants(
        name=name or f"Guard Tenant {suffix}",
        slug=slug or f"guard-tenant-{suffix}",
        custom_domain=custom_domain,
        custom_domain_active=custom_domain_active,
    )
    db.add(t)
    db.commit()
    db.refresh(t)
    return t


# ---------------------------------------------------------------------------
# Bug 1 — guard 4 no-op: custom_domain round-tripped unchanged
# ---------------------------------------------------------------------------


def test_admin_patch_sender_email_with_active_custom_domain_roundtrip(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    """Scenario 1: ADMIN patches sender_email while round-tripping the current custom_domain.

    With custom_domain_active=True and guard 4 lacking the != comparison, this
    returns HTTP 409 before the fix. Expected: HTTP 200 after fix.
    """
    suffix = uuid.uuid4().hex[:6]
    domain = f"s1-{suffix}.example.com"
    tenant_a.custom_domain = domain
    tenant_a.custom_domain_active = True
    db.add(tenant_a)
    db.commit()
    db.refresh(tenant_a)

    new_email = f"sender-s1-{suffix}@example.com"
    resp = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        json={"sender_email": new_email, "custom_domain": domain},
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["sender_email"] == new_email
    assert data["custom_domain"] == domain


def test_admin_patch_sender_name_with_active_custom_domain_roundtrip(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    """Scenario 2: ADMIN patches sender_name while round-tripping the current custom_domain.

    Expected: HTTP 200 after fix (409 before fix).
    """
    suffix = uuid.uuid4().hex[:6]
    domain = f"s2-{suffix}.example.com"
    tenant_a.custom_domain = domain
    tenant_a.custom_domain_active = True
    db.add(tenant_a)
    db.commit()
    db.refresh(tenant_a)

    new_name = f"Sender Name S2 {suffix}"
    resp = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        json={"sender_name": new_name, "custom_domain": domain},
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert resp.status_code == 200, resp.text
    data = resp.json()
    assert data["sender_name"] == new_name
    assert data["custom_domain"] == domain


def test_admin_change_custom_domain_while_active_fires_409(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    """Scenario 3 (sentinel): ADMIN sends a DIFFERENT custom_domain while active -> 409.

    This must PASS before the fix (guard 4's true intent is correct here).
    After the fix it must also pass — we only narrow, never remove, the guard.
    """
    suffix = uuid.uuid4().hex[:6]
    domain = f"s3-orig-{suffix}.example.com"
    tenant_a.custom_domain = domain
    tenant_a.custom_domain_active = True
    db.add(tenant_a)
    db.commit()
    db.refresh(tenant_a)

    new_domain = f"s3-new-{suffix}.example.com"
    resp = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        json={"custom_domain": new_domain},
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert resp.status_code == 409, resp.text
    assert "Cannot change custom domain while it is active" in resp.json()["detail"]


def test_admin_change_custom_domain_while_inactive_allowed(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    """Scenario 4 (sentinel): ADMIN changes custom_domain while inactive -> 200.

    Must PASS before and after fix.
    """
    suffix = uuid.uuid4().hex[:6]
    old_domain = f"s4-old-{suffix}.example.com"
    new_domain = f"s4-new-{suffix}.example.com"
    tenant_a.custom_domain = old_domain
    tenant_a.custom_domain_active = False
    db.add(tenant_a)
    db.commit()
    db.refresh(tenant_a)

    resp = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        json={"custom_domain": new_domain},
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["custom_domain"] == new_domain


def test_superadmin_change_custom_domain_while_active_bypasses_guard(
    client: TestClient,
    db: Session,
    superadmin_token: str,
) -> None:
    """Scenario 5 (sentinel): SUPERADMIN changes custom_domain while active -> 200.

    SUPERADMIN role bypasses guard 4 (first conjunct is the role check).
    Must PASS before and after fix.
    """
    suffix = uuid.uuid4().hex[:6]
    old_domain = f"s5-old-{suffix}.example.com"
    new_domain = f"s5-new-{suffix}.example.com"
    t = _make_tenant(
        db,
        suffix=suffix,
        custom_domain=old_domain,
        custom_domain_active=True,
    )
    resp = client.patch(
        f"/api/v1/tenants/{t.id}",
        json={"custom_domain": new_domain},
        headers=_superadmin_headers(superadmin_token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["custom_domain"] == new_domain


# ---------------------------------------------------------------------------
# Bug 2 — slug is internal; PATCH must not mutate it
# ---------------------------------------------------------------------------


def test_rename_does_not_rotate_slug(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    """Scenario 6: renaming a tenant must NOT overwrite its slug.

    Before fix: regenerate_slug validator overwrites slug with slugify(name).
    After fix: slug is absent from TenantUpdate; DB slug is untouched.
    """
    original_slug = tenant_a.slug
    suffix = uuid.uuid4().hex[:6]
    new_name = f"Renamed Corp {suffix}"

    resp = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        json={"name": new_name},
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert resp.status_code == 200, resp.text

    db.refresh(tenant_a)
    assert tenant_a.slug == original_slug, (
        f"slug must not change on rename: expected {original_slug!r}, got {tenant_a.slug!r}"
    )


def test_unchanged_name_does_not_rotate_slug(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    """Scenario 7: round-tripping the same name must NOT overwrite slug.

    Before fix: regenerate_slug fires if name is truthy (even unchanged).
    """
    original_slug = tenant_a.slug
    current_name = tenant_a.name

    resp = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        json={"name": current_name},
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert resp.status_code == 200, resp.text

    db.refresh(tenant_a)
    assert tenant_a.slug == original_slug, (
        f"slug must not change when name is round-tripped: expected {original_slug!r}, got {tenant_a.slug!r}"
    )


def test_slug_in_patch_body_matching_value_is_silently_ignored(
    client: TestClient,
    db: Session,
    superadmin_token: str,
) -> None:
    """Scenario 8 (sentinel): PATCH with slug matching current value -> 200, slug unchanged.

    Pydantic drops the unknown key silently (extra='ignore' default).
    Should PASS before and after fix (same value, no change triggered either way).
    Confirmed here as a sentinel to guard against regressions.
    """
    suffix = uuid.uuid4().hex[:6]
    slug = f"sc8-{suffix}"
    t = _make_tenant(db, suffix=suffix, slug=slug)

    resp = client.patch(
        f"/api/v1/tenants/{t.id}",
        json={"slug": slug},
        headers=_superadmin_headers(superadmin_token),
    )
    assert resp.status_code == 200, resp.text

    db.refresh(t)
    assert t.slug == slug


def test_slug_in_patch_body_different_value_is_silently_ignored(
    client: TestClient,
    db: Session,
    superadmin_token: str,
) -> None:
    """Scenario 8b: PATCH with a DIFFERENT slug value -> 200, DB slug unchanged.

    Before fix: slug field on TenantUpdate accepts the value and guard 5 (or the
    regenerate_slug validator) may overwrite the DB slug.
    After fix: field is absent from TenantUpdate; Pydantic drops the key; DB slug intact.
    """
    suffix = uuid.uuid4().hex[:6]
    slug = f"sc8b-{suffix}"
    t = _make_tenant(db, suffix=suffix, slug=slug)

    resp = client.patch(
        f"/api/v1/tenants/{t.id}",
        json={"slug": "something-else"},
        headers=_superadmin_headers(superadmin_token),
    )
    assert resp.status_code == 200, resp.text

    db.refresh(t)
    assert t.slug == slug, (
        f"slug must remain {slug!r} after PATCH with different slug body; got {t.slug!r}"
    )


def test_create_without_explicit_slug_generates_from_name(
    client: TestClient,
    superadmin_token: str,
) -> None:
    """Scenario 9 (sentinel): POST /tenants/ without slug -> slug derived from name.

    TenantCreate.generate_slug is the canonical path. Must PASS before and after fix.
    """
    suffix = uuid.uuid4().hex[:6]
    name = f"Acme Inc {suffix}"
    expected_slug = f"acme-inc-{suffix}"

    resp = client.post(
        "/api/v1/tenants/",
        json={"name": name},
        headers=_superadmin_headers(superadmin_token),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["slug"] == expected_slug


def test_create_with_explicit_slug_generates_from_name_anyway(
    client: TestClient,
    superadmin_token: str,
) -> None:
    """Scenario 10 (sentinel): POST /tenants/ with explicit slug -> slug still from name.

    TenantCreate.generate_slug overwrites the explicit slug field. Must PASS before/after fix.
    """
    suffix = uuid.uuid4().hex[:6]
    name = f"Acme Inc {suffix}"
    expected_slug = f"acme-inc-{suffix}"

    resp = client.post(
        "/api/v1/tenants/",
        json={"name": name, "slug": "my-custom-slug"},
        headers=_superadmin_headers(superadmin_token),
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["slug"] == expected_slug


def test_superadmin_patch_slug_is_also_ignored(
    client: TestClient,
    db: Session,
    superadmin_token: str,
) -> None:
    """Scenario 11: SUPERADMIN PATCH with different slug body -> 200, slug unchanged.

    Slug is internal regardless of role. Same silent-ignore as ADMIN path.
    Before fix: slug field accepted; DB slug could be overwritten.
    After fix: field absent from TenantUpdate; Pydantic drops it silently.
    """
    suffix = uuid.uuid4().hex[:6]
    slug = f"sc11-{suffix}"
    t = _make_tenant(db, suffix=suffix, slug=slug)

    resp = client.patch(
        f"/api/v1/tenants/{t.id}",
        json={"slug": "something-else"},
        headers=_superadmin_headers(superadmin_token),
    )
    assert resp.status_code == 200, resp.text

    db.refresh(t)
    assert t.slug == slug, (
        f"SUPERADMIN PATCH must not overwrite slug: expected {slug!r}, got {t.slug!r}"
    )


# ---------------------------------------------------------------------------
# Cross-cutting — full form payload (Scenario 13)
# ---------------------------------------------------------------------------


def test_full_object_patch_from_form_payload_noop(
    client: TestClient,
    db: Session,
    admin_token_tenant_a: str,
    tenant_a: Tenants,
) -> None:
    """Scenario 13: TenantForm.tsx-style full-object PATCH where nothing changed.

    The backoffice form pre-populates all fields from defaultValues and always
    sends a full payload. If custom_domain_active=True and custom_domain is
    round-tripped, this previously hit guard 4 with HTTP 409.
    After fix: HTTP 200, no field mutated.
    """
    suffix = uuid.uuid4().hex[:6]
    domain = f"s13-{suffix}.example.com"
    tenant_a.custom_domain = domain
    tenant_a.custom_domain_active = True
    db.add(tenant_a)
    db.commit()
    db.refresh(tenant_a)

    full_payload = {
        "name": tenant_a.name,
        "sender_email": str(tenant_a.sender_email) if tenant_a.sender_email else None,
        "sender_name": tenant_a.sender_name,
        "image_url": tenant_a.image_url,
        "icon_url": tenant_a.icon_url,
        "logo_url": tenant_a.logo_url,
        "custom_domain": domain,
    }
    full_payload = {k: v for k, v in full_payload.items() if v is not None}

    resp = client.patch(
        f"/api/v1/tenants/{tenant_a.id}",
        json=full_payload,
        headers=_admin_headers(admin_token_tenant_a),
    )
    assert resp.status_code == 200, resp.text

    data = resp.json()
    assert data["custom_domain"] == domain
    assert data["name"] == tenant_a.name
