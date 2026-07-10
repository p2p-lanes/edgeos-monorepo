"""Downscale and re-encode oversized CDN images in place.

Historic backoffice uploads reached the bucket at their original size
(4-8 MB); anything above the Next.js image optimizer's 7s upstream fetch
budget breaks portal product cards outright. New uploads are compressed
client-side since backoffice's compress-image helper landed; this script
retrofits the existing objects.

Images are overwritten under their SAME key so every reference keeps
working without DB updates: model columns, template_config JSONB,
rich-text/email HTML, and URLs already delivered in sent emails. The key
extension is left untouched while bytes/Content-Type become WebP; browsers
and the Next.js optimizer go by Content-Type, not extension.

Each original is copied to backup/originals/{key} before the first
overwrite (never clobbered on re-runs), so --restore can undo everything.

Runs with the backend environment's STORAGE_* settings and needs Pillow:

    cd backend
    uv run --with pillow python scripts/optimize_cdn_images.py                 # dry-run (default)
    uv run --with pillow python scripts/optimize_cdn_images.py --prefix <tenant-uuid>/
    uv run --with pillow python scripts/optimize_cdn_images.py --commit
    uv run --with pillow python scripts/optimize_cdn_images.py --restore --commit

After a --commit run, invalidate the CDN cache (CloudFront caches the old
bytes per URL): pass --cf-distribution-id to issue a single /* invalidation,
or run it manually from the AWS console.
"""

import argparse
import io
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from loguru import logger
from PIL import Image, ImageOps

from app.core.config import settings
from app.services.storage import storage_service

MAX_DIMENSION = 2560
WEBP_QUALITY = 82
WEBP_METHOD = 6  # slowest encoder, best compression; fine for a one-off
DEFAULT_MIN_KB = 500
# Keep the original unless the re-encode shaves at least this fraction off.
MIN_SAVINGS_RATIO = 0.10
CACHE_CONTROL = "public, max-age=31536000"  # 1 year; keys never change content again
BACKUP_PREFIX = "backup/originals/"

# GIFs would lose animation through re-encoding; everything else that the
# upload allowlist ever accepted is fair game.
PROCESSABLE_EXTENSIONS = {"jpg", "jpeg", "png", "webp"}


@dataclass
class Candidate:
    key: str
    size: int


def is_image_key(key: str) -> bool:
    if "/images/" not in key or key.startswith(BACKUP_PREFIX):
        return False
    extension = key.rsplit(".", 1)[-1].lower() if "." in key else ""
    return extension in PROCESSABLE_EXTENSIONS


def list_candidates(storage, prefix: str, min_bytes: int) -> list[Candidate]:
    paginator = storage.client.get_paginator("list_objects_v2")
    candidates = []
    for page in paginator.paginate(Bucket=storage.bucket, Prefix=prefix):
        for obj in page.get("Contents", []):
            if obj["Size"] >= min_bytes and is_image_key(obj["Key"]):
                candidates.append(Candidate(key=obj["Key"], size=obj["Size"]))
    return candidates


def optimize(content: bytes) -> bytes | None:
    """Return re-encoded WebP bytes, or None when the image should be kept.

    Skips animated images and anything Pillow cannot decode, and refuses
    results that are not meaningfully smaller than the source.
    """
    try:
        img = Image.open(io.BytesIO(content))
        if getattr(img, "is_animated", False):
            return None
        img = ImageOps.exif_transpose(img)
        img = img.convert("RGBA" if "A" in img.getbands() else "RGB")
        img.thumbnail((MAX_DIMENSION, MAX_DIMENSION), Image.LANCZOS)

        out = io.BytesIO()
        img.save(out, "WEBP", quality=WEBP_QUALITY, method=WEBP_METHOD)
        result = out.getvalue()
    except Exception as error:
        logger.warning("Cannot process image: {}", error)
        return None

    if len(result) >= len(content) * (1 - MIN_SAVINGS_RATIO):
        return None
    return result


def process(storage, candidate: Candidate, commit: bool) -> int:
    """Optimize one object in place. Returns bytes saved (0 when skipped)."""
    response = storage.client.get_object(Bucket=storage.bucket, Key=candidate.key)
    content = response["Body"].read()

    optimized = optimize(content)
    if optimized is None:
        logger.info(
            "SKIP {} ({} KB): no meaningful gain", candidate.key, candidate.size // 1024
        )
        return 0

    saved = len(content) - len(optimized)
    logger.info(
        "{} {}: {} KB -> {} KB",
        "OPTIMIZE" if commit else "WOULD OPTIMIZE",
        candidate.key,
        len(content) // 1024,
        len(optimized) // 1024,
    )
    if not commit:
        return saved

    backup_key = f"{BACKUP_PREFIX}{candidate.key}"
    if not storage.exists(backup_key):
        storage.client.copy_object(
            Bucket=storage.bucket,
            CopySource={"Bucket": storage.bucket, "Key": candidate.key},
            Key=backup_key,
        )

    storage.client.put_object(
        Bucket=storage.bucket,
        Key=candidate.key,
        Body=optimized,
        ContentType="image/webp",
        CacheControl=CACHE_CONTROL,
    )
    return saved


def restore(storage, prefix: str, commit: bool) -> int:
    """Copy every backup under the prefix back over its original key."""
    restored = 0
    for backup_key in storage.list_keys(f"{BACKUP_PREFIX}{prefix}"):
        original_key = backup_key.removeprefix(BACKUP_PREFIX)
        logger.info("{} {}", "RESTORE" if commit else "WOULD RESTORE", original_key)
        if commit:
            storage.client.copy_object(
                Bucket=storage.bucket,
                CopySource={"Bucket": storage.bucket, "Key": backup_key},
                Key=original_key,
            )
        restored += 1
    return restored


def invalidate_cloudfront(distribution_id: str) -> None:
    import time

    import boto3

    cloudfront = boto3.client(
        "cloudfront",
        aws_access_key_id=settings.STORAGE_ACCESS_KEY,
        aws_secret_access_key=settings.STORAGE_SECRET_KEY,
    )
    cloudfront.create_invalidation(
        DistributionId=distribution_id,
        InvalidationBatch={
            "Paths": {"Quantity": 1, "Items": ["/*"]},
            "CallerReference": f"optimize-cdn-images-{int(time.time())}",
        },
    )
    logger.info("CloudFront invalidation for /* submitted to {}", distribution_id)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--commit",
        action="store_true",
        help="Apply changes. Without it the script only reports what it would do.",
    )
    parser.add_argument(
        "--prefix",
        default="",
        help="Only process keys under this prefix (e.g. a tenant UUID followed by /).",
    )
    parser.add_argument(
        "--min-size-kb",
        type=int,
        default=DEFAULT_MIN_KB,
        help=f"Only process objects at or above this size (default {DEFAULT_MIN_KB}).",
    )
    parser.add_argument(
        "--limit", type=int, default=0, help="Stop after N objects (0 = no limit)."
    )
    parser.add_argument(
        "--restore",
        action="store_true",
        help="Copy backed-up originals back over their keys instead of optimizing.",
    )
    parser.add_argument(
        "--cf-distribution-id",
        default="",
        help="CloudFront distribution to invalidate (/*) after a --commit run.",
    )
    args = parser.parse_args()

    if not settings.storage_enabled:
        logger.error("STORAGE_ACCESS_KEY / STORAGE_SECRET_KEY are not configured")
        return 1

    storage = storage_service()
    logger.info(
        "Bucket {} | prefix {!r} | {}",
        storage.bucket,
        args.prefix,
        "COMMIT" if args.commit else "DRY-RUN",
    )

    if args.restore:
        count = restore(storage, args.prefix, args.commit)
        logger.info(
            "{} object(s) {}", count, "restored" if args.commit else "to restore"
        )
        return 0

    candidates = list_candidates(storage, args.prefix, args.min_size_kb * 1024)
    if args.limit:
        candidates = candidates[: args.limit]
    logger.info(
        "{} candidate(s) >= {} KB, {} MB total",
        len(candidates),
        args.min_size_kb,
        sum(c.size for c in candidates) // (1024 * 1024),
    )

    saved = 0
    failures = 0
    for candidate in candidates:
        try:
            saved += process(storage, candidate, args.commit)
        except Exception as error:
            failures += 1
            logger.error("FAIL {}: {}", candidate.key, error)

    logger.info(
        "Done: {} MB {} across {} object(s), {} failure(s)",
        saved // (1024 * 1024),
        "saved" if args.commit else "to save",
        len(candidates),
        failures,
    )

    if args.commit and args.cf_distribution_id:
        invalidate_cloudfront(args.cf_distribution_id)
    elif args.commit:
        logger.warning(
            "Remember to invalidate the CDN cache; cached objects keep serving the old bytes"
        )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
