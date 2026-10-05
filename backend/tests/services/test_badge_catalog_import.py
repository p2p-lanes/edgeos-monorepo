"""SIM-108: importing Timour's badge artwork manifest into a tenant."""

import uuid
from pathlib import Path

from PIL import Image
from sqlmodel import Session, select

from app.api.badge.models import Badges, BadgeStyles
from app.api.tenant.models import Tenants
from app.services.badge_catalog_import import import_badge_catalog


class FakeStorage:
    def __init__(self) -> None:
        self.uploads: dict[str, tuple[bytes, str]] = {}

    def upload_bytes(self, key: str, content: bytes, content_type: str) -> None:
        self.uploads[key] = (content, content_type)

    def get_public_url(self, key: str) -> str:
        return f"https://cdn.test/{key}"


def _manifest() -> dict:
    activities = [
        {
            "id": "sauna",
            "name": "Sauna",
            "category": "Wellbeing",
            "description": "Sauna sessions. A possible badge subject; recognition "
            "and milestone rules are chosen separately.",
        },
        {"id": "yoga", "name": "Yoga", "category": "Movement", "description": None},
    ]
    return {
        "default_style_id": "glass",
        "styles": [
            {"id": "glass", "name": "Luminous glass"},
            {"id": "ceramic", "name": "Sculpted ceramics"},
        ],
        "activities": activities,
        "assets": [
            {
                "activity_id": a["id"],
                "style_id": style,
                "file": f"assets/{style}/{a['id']}.png",
            }
            for a in activities
            for style in ("glass", "ceramic")
        ],
    }


def _write_pngs(root: Path, manifest: dict, *, skip: str | None = None) -> None:
    for asset in manifest["assets"]:
        if asset["file"] == skip:
            continue
        path = root / asset["file"]
        path.parent.mkdir(parents=True, exist_ok=True)
        Image.new("RGBA", (1254, 1254), (200, 120, 40, 128)).save(path)


def test_import_creates_styles_badges_and_resized_images(db: Session, tmp_path):
    tenant = Tenants(name="Import", slug=f"import-{uuid.uuid4().hex[:8]}")
    db.add(tenant)
    db.commit()
    manifest = _manifest()
    manifest["activities"].append(
        {"id": "dance", "name": "Dance", "category": "Movement"}
    )
    manifest["assets"] += [
        {"activity_id": "dance", "style_id": style, "file": f"assets/{style}/dance.png"}
        for style in ("glass", "ceramic")
    ]
    _write_pngs(tmp_path, manifest, skip="assets/ceramic/yoga.png")
    # Dance has no artwork on disk at all, so it must not be created.
    for style in ("glass", "ceramic"):
        (tmp_path / f"assets/{style}/dance.png").unlink()
    storage = FakeStorage()

    report = import_badge_catalog(
        db,
        tenant_id=tenant.id,
        manifest=manifest,
        assets_dir=tmp_path,
        storage=storage,
        size=256,
    )

    assert report.styles_created == ["glass", "ceramic"]
    assert sorted(report.badges_created) == ["sauna", "yoga"]
    assert report.images_uploaded == 3
    assert sorted(report.missing_files) == [
        "assets/ceramic/dance.png",
        "assets/ceramic/yoga.png",
        "assets/glass/dance.png",
    ]

    styles = {
        s.key: s
        for s in db.exec(
            select(BadgeStyles).where(BadgeStyles.tenant_id == tenant.id)
        ).all()
    }
    assert styles["glass"].is_default and not styles["ceramic"].is_default

    sauna = db.exec(
        select(Badges).where(Badges.tenant_id == tenant.id, Badges.slug == "sauna")
    ).one()
    assert sauna.description == "Sauna sessions."
    assert {img.width for img in sauna.images} == {256}

    key = f"{tenant.id}/badges/glass/sauna.webp"
    content, content_type = storage.uploads[key]
    assert content_type == "image/webp"
    assert content[:4] == b"RIFF"

    # Re-running keeps admin edits and only fills the gaps.
    sauna.name = "Sauna regular"
    db.add(sauna)
    db.commit()
    _write_pngs(tmp_path, manifest, skip="assets/glass/dance.png")
    again = import_badge_catalog(
        db,
        tenant_id=tenant.id,
        manifest=manifest,
        assets_dir=tmp_path,
        storage=storage,
        size=256,
    )
    assert again.styles_created == [] and again.badges_created == ["dance"]
    assert again.images_uploaded == 2 and again.images_skipped == 3
    db.refresh(sauna)
    assert sauna.name == "Sauna regular"
