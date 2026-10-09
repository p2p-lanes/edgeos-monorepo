"""Import a badge artwork catalog (manifest + PNGs) into a tenant.

Built for the Edge City activity badges delivered as ``asset-catalog.json``
(``styles[]``, ``activities[]``, ``assets[]`` mapping activity x style to a
PNG file). Originals are ~1MB 1254px PNGs, so each one is downscaled to a
square webp before upload.

Idempotent: styles are matched by key, badges by slug (the activity id), and
existing badge fields are never overwritten, so an admin's edits survive a
re-run. Only images missing for a (badge, style) pair are uploaded unless
``overwrite_images`` is set.
"""

import io
import json
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from PIL import Image
from sqlmodel import Session, select

from app.api.badge.crud import set_default_style, upsert_image
from app.api.badge.models import Badges, BadgeStyles

# Designer note appended to every activity description in the manifest; it
# describes the catalog, not the badge, so it is not shown to attendees.
_DESIGN_NOTE = " A possible badge subject"


class Storage(Protocol):
    def upload_bytes(self, key: str, content: bytes, content_type: str) -> None: ...

    def get_public_url(self, key: str) -> str: ...


@dataclass
class ImportReport:
    styles_created: list[str] = field(default_factory=list)
    badges_created: list[str] = field(default_factory=list)
    images_uploaded: int = 0
    images_skipped: int = 0
    missing_files: list[str] = field(default_factory=list)


def to_webp(path: Path, size: int, quality: int = 85) -> tuple[bytes, int, int]:
    """Downscale an image to fit ``size`` x ``size``, keeping transparency."""
    with Image.open(path) as img:
        img = img.convert("RGBA")
        img.thumbnail((size, size), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="WEBP", quality=quality, method=6)
        return out.getvalue(), img.width, img.height


def _clean_description(text: str | None) -> str | None:
    if not text:
        return None
    return text.split(_DESIGN_NOTE)[0].strip() or None


def import_badge_catalog(
    db: Session,
    *,
    tenant_id: uuid.UUID,
    manifest: dict,
    assets_dir: Path,
    storage: Storage,
    size: int = 512,
    overwrite_images: bool = False,
    dry_run: bool = False,
) -> ImportReport:
    report = ImportReport()

    styles: dict[str, BadgeStyles] = {
        s.key: s
        for s in db.exec(
            select(BadgeStyles).where(BadgeStyles.tenant_id == tenant_id)
        ).all()
    }
    for order, entry in enumerate(manifest.get("styles", [])):
        if entry["id"] in styles:
            continue
        style = BadgeStyles(
            tenant_id=tenant_id, key=entry["id"], name=entry["name"], sort_order=order
        )
        db.add(style)
        db.flush()
        styles[style.key] = style
        report.styles_created.append(style.key)

    if not any(s.is_default for s in styles.values()):
        default_key = manifest.get("default_style_id")
        default = styles.get(default_key) if default_key else None
        default = default or next(iter(styles.values()), None)
        if default:
            set_default_style(db, default)

    badges: dict[str, Badges] = {
        b.slug: b
        for b in db.exec(select(Badges).where(Badges.tenant_id == tenant_id)).all()
    }
    activities = {a["id"]: a for a in manifest.get("activities", [])}

    for asset in manifest.get("assets", []):
        activity = activities.get(asset["activity_id"])
        style = styles.get(asset["style_id"])
        if not activity or not style:
            continue
        badge = badges.get(activity["id"])
        if badge is not None:
            has_image = any(img.style_id == style.id for img in badge.images)
            if has_image and not overwrite_images:
                report.images_skipped += 1
                continue
        source = assets_dir / asset["file"]
        if not source.exists():
            report.missing_files.append(asset["file"])
            continue
        if badge is None:
            # Created only once its first artwork is at hand: a badge
            # without any image would break the catalog's invariant.
            badge = Badges(
                tenant_id=tenant_id,
                slug=activity["id"],
                name=activity["name"],
                category=activity.get("category"),
                description=_clean_description(activity.get("description")),
            )
            db.add(badge)
            db.flush()
            badges[badge.slug] = badge
            report.badges_created.append(badge.slug)
        content, width, height = to_webp(source, size)
        key = f"{tenant_id}/badges/{style.key}/{badge.slug}.webp"
        if not dry_run:
            storage.upload_bytes(key, content, "image/webp")
        upsert_image(db, badge, style.id, storage.get_public_url(key), width, height)
        report.images_uploaded += 1

    if dry_run:
        db.rollback()
    else:
        db.commit()
    return report


def load_manifest(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))
