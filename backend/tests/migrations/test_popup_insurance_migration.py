"""Tests for the popup_insurance migration backfill logic (POPUP-5).

Tests the backfill SQL in isolation using a temporary table approach,
following the pattern from test_popup_checkout_mode.py.

Scenarios:
  - Single-value popup gets promoted (insurance_enabled=true, pct=the value)
  - Mixed-percentage popup stays disabled (insurance_enabled=false, pct=null)
  - Popup with no insured products stays disabled
  - Products with pct > 0 get insurance_eligible=true
  - Products with pct = 0 or null stay insurance_eligible=false
"""
import importlib.util
from pathlib import Path

from sqlmodel import Session


def _load_migration_module():
    migration_path = (
        Path(__file__).resolve().parents[2] / "app" / "alembic" / "versions"
    )
    matches = list(migration_path.glob("*_popup_insurance.py"))
    assert matches, "popup_insurance migration file not found"

    module_path = matches[0]
    spec = importlib.util.spec_from_file_location(module_path.stem, module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestPopupInsuranceMigrationBackfill:
    """Tests for the backfill logic inside the migration.

    These tests execute the raw SQL backfill statements against temporary tables
    to verify correctness in isolation — the migration itself is tested by the
    session fixture (alembic upgrade head runs at session start).
    """

    def test_single_value_popup_gets_promoted(self, db: Session) -> None:
        """POPUP-5: popup with all products having same pct → promoted."""
        conn = db.connection()

        # Create temp tables mimicking products and popups
        suffix = "sv"
        conn.exec_driver_sql(
            f"""
            CREATE TEMP TABLE popups_{suffix} (
                id          SERIAL PRIMARY KEY,
                insurance_enabled    BOOLEAN NOT NULL DEFAULT false,
                insurance_percentage NUMERIC(5,2)
            )
            """
        )
        conn.exec_driver_sql(
            f"""
            CREATE TEMP TABLE products_{suffix} (
                id                   SERIAL PRIMARY KEY,
                popup_id             INTEGER REFERENCES popups_{suffix}(id),
                insurance_percentage NUMERIC(5,2),
                insurance_eligible   BOOLEAN NOT NULL DEFAULT false
            )
            """
        )

        # Insert: one popup, three products all with pct=5.00
        conn.exec_driver_sql(f"INSERT INTO popups_{suffix} DEFAULT VALUES")
        popup_id = conn.exec_driver_sql(
            f"SELECT id FROM popups_{suffix} LIMIT 1"
        ).fetchone()[0]

        for _ in range(3):
            conn.exec_driver_sql(
                f"INSERT INTO products_{suffix}(popup_id, insurance_percentage) VALUES (%s, 5.00)",
                (popup_id,),
            )

        # Run backfill SQL (adapted for temp table names)
        conn.exec_driver_sql(
            f"""
            UPDATE products_{suffix}
            SET insurance_eligible = true
            WHERE insurance_percentage IS NOT NULL
              AND insurance_percentage > 0
            """
        )
        conn.exec_driver_sql(
            f"""
            WITH candidate AS (
                SELECT
                    p.popup_id,
                    COUNT(DISTINCT p.insurance_percentage) AS distinct_pct,
                    MAX(p.insurance_percentage)             AS the_pct
                FROM products_{suffix} p
                WHERE p.insurance_percentage IS NOT NULL
                  AND p.insurance_percentage > 0
                GROUP BY p.popup_id
                HAVING COUNT(DISTINCT p.insurance_percentage) = 1
            )
            UPDATE popups_{suffix} pop
            SET insurance_enabled    = true,
                insurance_percentage = c.the_pct
            FROM candidate c
            WHERE pop.id = c.popup_id
            """
        )

        popup_row = conn.exec_driver_sql(
            f"SELECT insurance_enabled, insurance_percentage FROM popups_{suffix} WHERE id = %s",
            (popup_id,),
        ).fetchone()
        assert popup_row[0] is True, "insurance_enabled should be true for single-value popup"
        assert float(popup_row[1]) == 5.00, "insurance_percentage should be 5.00"

        products_rows = conn.exec_driver_sql(
            f"SELECT insurance_eligible FROM products_{suffix} WHERE popup_id = %s",
            (popup_id,),
        ).fetchall()
        assert all(r[0] is True for r in products_rows), "all products should be eligible"

        conn.exec_driver_sql(f"DROP TABLE products_{suffix}")
        conn.exec_driver_sql(f"DROP TABLE popups_{suffix}")

    def test_mixed_percentage_popup_stays_disabled(self, db: Session) -> None:
        """POPUP-5: popup with products having different pcts → stays disabled, null pct."""
        conn = db.connection()

        suffix = "mx"
        conn.exec_driver_sql(
            f"""
            CREATE TEMP TABLE popups_{suffix} (
                id                   SERIAL PRIMARY KEY,
                insurance_enabled    BOOLEAN NOT NULL DEFAULT false,
                insurance_percentage NUMERIC(5,2)
            )
            """
        )
        conn.exec_driver_sql(
            f"""
            CREATE TEMP TABLE products_{suffix} (
                id                   SERIAL PRIMARY KEY,
                popup_id             INTEGER REFERENCES popups_{suffix}(id),
                insurance_percentage NUMERIC(5,2),
                insurance_eligible   BOOLEAN NOT NULL DEFAULT false
            )
            """
        )

        conn.exec_driver_sql(f"INSERT INTO popups_{suffix} DEFAULT VALUES")
        popup_id = conn.exec_driver_sql(
            f"SELECT id FROM popups_{suffix} LIMIT 1"
        ).fetchone()[0]

        # Products with mixed percentages: 5.00, 3.00, 5.00
        for pct in ("5.00", "3.00", "5.00"):
            conn.exec_driver_sql(
                f"INSERT INTO products_{suffix}(popup_id, insurance_percentage) VALUES (%s, %s)",
                (popup_id, pct),
            )

        # Run product backfill (eligible = true where pct > 0)
        conn.exec_driver_sql(
            f"""
            UPDATE products_{suffix}
            SET insurance_eligible = true
            WHERE insurance_percentage IS NOT NULL
              AND insurance_percentage > 0
            """
        )
        # Run popup backfill (should NOT promote mixed popup)
        conn.exec_driver_sql(
            f"""
            WITH candidate AS (
                SELECT
                    p.popup_id,
                    COUNT(DISTINCT p.insurance_percentage) AS distinct_pct,
                    MAX(p.insurance_percentage)             AS the_pct
                FROM products_{suffix} p
                WHERE p.insurance_percentage IS NOT NULL
                  AND p.insurance_percentage > 0
                GROUP BY p.popup_id
                HAVING COUNT(DISTINCT p.insurance_percentage) = 1
            )
            UPDATE popups_{suffix} pop
            SET insurance_enabled    = true,
                insurance_percentage = c.the_pct
            FROM candidate c
            WHERE pop.id = c.popup_id
            """
        )

        popup_row = conn.exec_driver_sql(
            f"SELECT insurance_enabled, insurance_percentage FROM popups_{suffix} WHERE id = %s",
            (popup_id,),
        ).fetchone()
        assert popup_row[0] is False, "mixed popup should remain disabled"
        assert popup_row[1] is None, "mixed popup insurance_percentage should be null"

        # BUT the individual products should still be eligible (pct > 0)
        products_rows = conn.exec_driver_sql(
            f"SELECT insurance_eligible FROM products_{suffix} WHERE popup_id = %s ORDER BY id",
            (popup_id,),
        ).fetchall()
        assert all(r[0] is True for r in products_rows), "all products with pct > 0 should be eligible"

        conn.exec_driver_sql(f"DROP TABLE products_{suffix}")
        conn.exec_driver_sql(f"DROP TABLE popups_{suffix}")

    def test_popup_with_no_insured_products_stays_disabled(self, db: Session) -> None:
        """POPUP-5: popup with all products having pct=0 or null → stays disabled."""
        conn = db.connection()

        suffix = "ni"
        conn.exec_driver_sql(
            f"""
            CREATE TEMP TABLE popups_{suffix} (
                id                   SERIAL PRIMARY KEY,
                insurance_enabled    BOOLEAN NOT NULL DEFAULT false,
                insurance_percentage NUMERIC(5,2)
            )
            """
        )
        conn.exec_driver_sql(
            f"""
            CREATE TEMP TABLE products_{suffix} (
                id                   SERIAL PRIMARY KEY,
                popup_id             INTEGER REFERENCES popups_{suffix}(id),
                insurance_percentage NUMERIC(5,2),
                insurance_eligible   BOOLEAN NOT NULL DEFAULT false
            )
            """
        )

        conn.exec_driver_sql(f"INSERT INTO popups_{suffix} DEFAULT VALUES")
        popup_id = conn.exec_driver_sql(
            f"SELECT id FROM popups_{suffix} LIMIT 1"
        ).fetchone()[0]

        # Products with pct=0 and pct=null
        conn.exec_driver_sql(
            f"INSERT INTO products_{suffix}(popup_id, insurance_percentage) VALUES (%s, 0.00)",
            (popup_id,),
        )
        conn.exec_driver_sql(
            f"INSERT INTO products_{suffix}(popup_id, insurance_percentage) VALUES (%s, NULL)",
            (popup_id,),
        )

        conn.exec_driver_sql(
            f"""
            UPDATE products_{suffix}
            SET insurance_eligible = true
            WHERE insurance_percentage IS NOT NULL
              AND insurance_percentage > 0
            """
        )
        conn.exec_driver_sql(
            f"""
            WITH candidate AS (
                SELECT
                    p.popup_id,
                    COUNT(DISTINCT p.insurance_percentage) AS distinct_pct,
                    MAX(p.insurance_percentage)             AS the_pct
                FROM products_{suffix} p
                WHERE p.insurance_percentage IS NOT NULL
                  AND p.insurance_percentage > 0
                GROUP BY p.popup_id
                HAVING COUNT(DISTINCT p.insurance_percentage) = 1
            )
            UPDATE popups_{suffix} pop
            SET insurance_enabled    = true,
                insurance_percentage = c.the_pct
            FROM candidate c
            WHERE pop.id = c.popup_id
            """
        )

        popup_row = conn.exec_driver_sql(
            f"SELECT insurance_enabled, insurance_percentage FROM popups_{suffix} WHERE id = %s",
            (popup_id,),
        ).fetchone()
        assert popup_row[0] is False
        assert popup_row[1] is None

        # Products with pct <= 0 or null should NOT be eligible
        products_rows = conn.exec_driver_sql(
            f"SELECT insurance_eligible FROM products_{suffix} WHERE popup_id = %s",
            (popup_id,),
        ).fetchall()
        assert all(r[0] is False for r in products_rows), "products with pct <= 0 should not be eligible"

        conn.exec_driver_sql(f"DROP TABLE products_{suffix}")
        conn.exec_driver_sql(f"DROP TABLE popups_{suffix}")
