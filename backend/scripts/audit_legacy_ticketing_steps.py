#!/usr/bin/env python3
"""
Pre-removal SQL audit: detect ticketing steps that would fall into the
legacy STEP_COMPONENT_REGISTRY path after the Slice 2 registry removal.

Run this BEFORE merging the PR that removes STEP_COMPONENT_REGISTRY.

Usage:
    DATABASE_URL=... python backend/scripts/audit_legacy_ticketing_steps.py

Expected result: 0 rows (confirmed by user pre-change — Q3 decision).
If rows are returned, set the appropriate template (merch-image, housing-date,
patron-preset) on each step before merging.
"""
import os
import sys

try:
    import psycopg2
except ImportError:
    print("psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)

DATABASE_URL = os.environ.get("DATABASE_URL")
if not DATABASE_URL:
    print("ERROR: DATABASE_URL environment variable is not set.")
    sys.exit(1)

AUDIT_QUERY = """
SELECT
    ts.id,
    ts.popup_id,
    ts.step_type,
    ts.title,
    ts.template,
    ts.product_category,
    p.slug AS popup_slug
FROM ticketing_steps ts
LEFT JOIN popups p ON p.id = ts.popup_id
WHERE ts.template IS NULL
  AND ts.step_type NOT IN ('tickets', 'buyer', 'confirm')
  AND ts.is_enabled = true
ORDER BY p.slug, ts.step_type;
"""

TEMPLATE_SUGGESTIONS = {
    "housing": "housing-date",
    "merch": "merch-image",
    "patron": "patron-preset",
}


def main() -> None:
    conn = psycopg2.connect(DATABASE_URL)
    try:
        with conn.cursor() as cur:
            cur.execute(AUDIT_QUERY)
            rows = cur.fetchall()
            columns = [desc[0] for desc in cur.description]

        if not rows:
            print("AUDIT PASS: 0 legacy steps found. Safe to merge Slice 2.")
            return

        print(
            f"AUDIT FAIL: {len(rows)} step(s) would fall into the "
            "legacy path after STEP_COMPONENT_REGISTRY removal.\n"
        )
        print(f"{'  '.join(columns)}")
        print("-" * 80)
        for row in rows:
            row_dict = dict(zip(columns, row))
            print("  ".join(str(v) for v in row))
            suggestion = TEMPLATE_SUGGESTIONS.get(row_dict.get("step_type", ""))
            if suggestion:
                print(
                    f"  → Suggested fix: "
                    f"UPDATE ticketing_steps SET template = '{suggestion}' "
                    f"WHERE id = '{row_dict['id']}';"
                )

        print(
            "\nRun the suggested UPDATE statements (or set templates via "
            "the backoffice) before merging."
        )
        sys.exit(1)
    finally:
        conn.close()


if __name__ == "__main__":
    main()
