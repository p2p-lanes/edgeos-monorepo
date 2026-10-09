"""
Import a badge artwork catalog into a tenant (SIM-108).

Reads an ``asset-catalog.json`` manifest (styles, activities, assets) and the
folder holding its PNGs, then creates the missing styles and badges and
uploads each image as a 512px webp. Safe to re-run: existing styles, badges
and images are left as they are (``--overwrite-images`` replaces artwork).

The Edge City originals are published as zips next to the manifest; unzip
them all into one folder so ``assets/glass/*.png`` and ``assets/ceramic/*.png``
sit under ``--assets-dir``.

Usage:
    cd backend && uv run python scripts/import_badge_catalog.py \\
        --tenant edge-city \\
        --manifest ~/Downloads/asset-catalog.json \\
        --assets-dir ~/Downloads/badges

    # ...and to see what it would do, without writing anything:
    ... --dry-run
"""

import argparse
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from loguru import logger  # noqa: E402
from sqlmodel import Session, select  # noqa: E402

import app.models  # noqa: F401,E402  registers every mapper before we query
from app.api.tenant.models import Tenants  # noqa: E402
from app.core.db import engine  # noqa: E402
from app.services.badge_catalog_import import (  # noqa: E402
    import_badge_catalog,
    load_manifest,
)
from app.services.storage import storage_service  # noqa: E402


def resolve_tenant(session: Session, ref: str) -> Tenants:
    try:
        tenant = session.get(Tenants, uuid.UUID(ref))
    except ValueError:
        tenant = session.exec(select(Tenants).where(Tenants.slug == ref)).first()
    if not tenant:
        logger.error(f"No tenant with id or slug {ref!r}")
        raise SystemExit(1)
    return tenant


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--tenant", required=True, help="Tenant id or slug")
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--assets-dir", required=True, type=Path)
    parser.add_argument("--size", type=int, default=512, help="Max edge in px")
    parser.add_argument("--overwrite-images", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    manifest = load_manifest(args.manifest.expanduser())
    with Session(engine) as session:
        tenant = resolve_tenant(session, args.tenant)
        tenant_slug = tenant.slug
        report = import_badge_catalog(
            session,
            tenant_id=tenant.id,
            manifest=manifest,
            assets_dir=args.assets_dir.expanduser(),
            storage=storage_service(),
            size=args.size,
            overwrite_images=args.overwrite_images,
            dry_run=args.dry_run,
        )

    prefix = "[dry run] " if args.dry_run else ""
    logger.info(f"{prefix}Tenant {tenant_slug}")
    logger.info(f"{prefix}Styles created: {report.styles_created or 'none'}")
    logger.info(f"{prefix}Badges created: {len(report.badges_created)}")
    logger.info(
        f"{prefix}Images uploaded: {report.images_uploaded}, "
        f"already present: {report.images_skipped}"
    )
    if report.missing_files:
        logger.warning(f"Missing files: {report.missing_files}")


if __name__ == "__main__":
    main()
