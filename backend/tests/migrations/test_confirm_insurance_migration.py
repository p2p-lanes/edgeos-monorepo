"""Tests for the confirm-insurance migration (Batch 4).

Verifies:
  1. Rows with step_type = 'insurance_checkout' are deleted
  2. confirm step gets template_config.insurance defaults (if null or missing 'insurance' key)
  3. Existing customizations in confirm template_config are not overwritten
  4. Migration is idempotent
"""

import json

from sqlmodel import Session

_INSURANCE_DEFAULTS = {
    "card_title": "Insurance",
    "card_subtitle": "Change of plans coverage",
    "toggle_label": "Add insurance",
    "benefits": [
        "Full refund up to 14 days before the event",
        "50% refund up to 7 days before",
        "Free date change at no extra cost",
    ],
}


def _setup_temp_tables(conn, suffix: str) -> None:
    conn.exec_driver_sql(
        f"""
        CREATE TEMP TABLE popups_{suffix} (
            id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            tenant_id   UUID NOT NULL DEFAULT gen_random_uuid()
        )
        """
    )
    conn.exec_driver_sql(
        f"""
        CREATE TEMP TABLE ticketingsteps_{suffix} (
            id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            popup_id        UUID REFERENCES popups_{suffix}(id),
            tenant_id       UUID NOT NULL DEFAULT gen_random_uuid(),
            step_type       TEXT NOT NULL,
            title           TEXT NOT NULL DEFAULT '',
            "order"         INTEGER NOT NULL DEFAULT 0,
            is_enabled      BOOLEAN NOT NULL DEFAULT true,
            protected       BOOLEAN NOT NULL DEFAULT false,
            template        TEXT,
            template_config JSONB
        )
        """
    )


def _run_migration_sql(conn, suffix: str) -> None:
    """Execute the migration SQL adapted for temp table names."""
    # Step 1: DELETE insurance_checkout rows
    conn.exec_driver_sql(
        f"DELETE FROM ticketingsteps_{suffix} WHERE step_type = 'insurance_checkout'"
    )

    # Step 2: UPDATE confirm steps — set template_config.insurance if not already set.
    # `jsonb_typeof <> 'object'` guards against JSON null (non-SQL-null) values where
    # `||` would otherwise produce `[null, {obj}]` instead of `{obj}`.
    conn.exec_driver_sql(
        f"""
        UPDATE ticketingsteps_{suffix}
        SET template_config = CASE
            WHEN template_config IS NULL
                OR jsonb_typeof(template_config) <> 'object'
            THEN %s::jsonb
            WHEN NOT (template_config ? 'insurance')
            THEN template_config || jsonb_build_object('insurance', %s::jsonb -> 'insurance')
            ELSE template_config
        END
        WHERE step_type = 'confirm'
        """,
        (
            json.dumps({"insurance": _INSURANCE_DEFAULTS}),
            json.dumps({"insurance": _INSURANCE_DEFAULTS}),
        ),
    )


class TestConfirmInsuranceMigration:
    def test_insurance_checkout_rows_deleted(self, db: Session) -> None:
        """Batch4: insurance_checkout rows are deleted by migration."""
        conn = db.connection()
        suffix = "b4_del"
        _setup_temp_tables(conn, suffix)

        popup_id = conn.exec_driver_sql(
            f"INSERT INTO popups_{suffix} DEFAULT VALUES RETURNING id"
        ).fetchone()[0]
        tenant_id = conn.exec_driver_sql("SELECT gen_random_uuid()").fetchone()[0]

        conn.exec_driver_sql(
            f"""
            INSERT INTO ticketingsteps_{suffix} (popup_id, tenant_id, step_type)
            VALUES (%s, %s, 'insurance_checkout')
            """,
            (popup_id, tenant_id),
        )
        conn.exec_driver_sql(
            f"""
            INSERT INTO ticketingsteps_{suffix} (popup_id, tenant_id, step_type)
            VALUES (%s, %s, 'confirm')
            """,
            (popup_id, tenant_id),
        )

        _run_migration_sql(conn, suffix)

        row = conn.exec_driver_sql(
            f"SELECT id FROM ticketingsteps_{suffix} WHERE step_type = 'insurance_checkout'",
        ).fetchone()
        assert row is None, "insurance_checkout rows must be deleted"

        # confirm step must still exist
        confirm = conn.exec_driver_sql(
            f"SELECT id FROM ticketingsteps_{suffix} WHERE step_type = 'confirm'",
        ).fetchone()
        assert confirm is not None

        conn.exec_driver_sql(f"DROP TABLE ticketingsteps_{suffix}")
        conn.exec_driver_sql(f"DROP TABLE popups_{suffix}")

    def test_confirm_step_null_template_config_gets_insurance_defaults(
        self, db: Session
    ) -> None:
        """Batch4: confirm step with NULL template_config gets insurance defaults."""
        conn = db.connection()
        suffix = "b4_null"
        _setup_temp_tables(conn, suffix)

        popup_id = conn.exec_driver_sql(
            f"INSERT INTO popups_{suffix} DEFAULT VALUES RETURNING id"
        ).fetchone()[0]
        tenant_id = conn.exec_driver_sql("SELECT gen_random_uuid()").fetchone()[0]

        conn.exec_driver_sql(
            f"""
            INSERT INTO ticketingsteps_{suffix} (popup_id, tenant_id, step_type, template_config)
            VALUES (%s, %s, 'confirm', NULL)
            """,
            (popup_id, tenant_id),
        )

        _run_migration_sql(conn, suffix)

        row = conn.exec_driver_sql(
            f"SELECT template_config FROM ticketingsteps_{suffix} WHERE step_type = 'confirm' AND popup_id = %s",
            (popup_id,),
        ).fetchone()
        assert row is not None
        tc = row[0]
        assert isinstance(tc, dict)
        assert "insurance" in tc
        ins = tc["insurance"]
        assert ins["card_title"] == "Insurance"
        assert ins["card_subtitle"] == "Change of plans coverage"
        assert ins["toggle_label"] == "Add insurance"
        assert isinstance(ins["benefits"], list)
        assert len(ins["benefits"]) == 3

        conn.exec_driver_sql(f"DROP TABLE ticketingsteps_{suffix}")
        conn.exec_driver_sql(f"DROP TABLE popups_{suffix}")

    def test_confirm_step_existing_template_config_gets_insurance_key_appended(
        self, db: Session
    ) -> None:
        """Batch4: confirm step with existing template_config (no 'insurance' key) gets it appended."""
        conn = db.connection()
        suffix = "b4_app"
        _setup_temp_tables(conn, suffix)

        popup_id = conn.exec_driver_sql(
            f"INSERT INTO popups_{suffix} DEFAULT VALUES RETURNING id"
        ).fetchone()[0]
        tenant_id = conn.exec_driver_sql("SELECT gen_random_uuid()").fetchone()[0]

        existing_config = json.dumps({"patron": {"presets": [1000, 2000]}})
        conn.exec_driver_sql(
            f"""
            INSERT INTO ticketingsteps_{suffix} (popup_id, tenant_id, step_type, template_config)
            VALUES (%s, %s, 'confirm', %s::jsonb)
            """,
            (popup_id, tenant_id, existing_config),
        )

        _run_migration_sql(conn, suffix)

        row = conn.exec_driver_sql(
            f"SELECT template_config FROM ticketingsteps_{suffix} WHERE step_type = 'confirm' AND popup_id = %s",
            (popup_id,),
        ).fetchone()
        tc = row[0]
        # Original key must remain
        assert "patron" in tc, "existing keys must be preserved"
        # New insurance key must be added
        assert "insurance" in tc, "'insurance' key must be appended"

        conn.exec_driver_sql(f"DROP TABLE ticketingsteps_{suffix}")
        conn.exec_driver_sql(f"DROP TABLE popups_{suffix}")

    def test_confirm_step_existing_insurance_key_not_overwritten(
        self, db: Session
    ) -> None:
        """Batch4: confirm step with existing template_config.insurance is NOT overwritten."""
        conn = db.connection()
        suffix = "b4_keep"
        _setup_temp_tables(conn, suffix)

        popup_id = conn.exec_driver_sql(
            f"INSERT INTO popups_{suffix} DEFAULT VALUES RETURNING id"
        ).fetchone()[0]
        tenant_id = conn.exec_driver_sql("SELECT gen_random_uuid()").fetchone()[0]

        custom_insurance = {
            "card_title": "Custom Title",
            "benefits": ["Custom benefit"],
        }
        existing_config = json.dumps({"insurance": custom_insurance})
        conn.exec_driver_sql(
            f"""
            INSERT INTO ticketingsteps_{suffix} (popup_id, tenant_id, step_type, template_config)
            VALUES (%s, %s, 'confirm', %s::jsonb)
            """,
            (popup_id, tenant_id, existing_config),
        )

        _run_migration_sql(conn, suffix)

        row = conn.exec_driver_sql(
            f"SELECT template_config FROM ticketingsteps_{suffix} WHERE step_type = 'confirm' AND popup_id = %s",
            (popup_id,),
        ).fetchone()
        tc = row[0]
        assert tc["insurance"]["card_title"] == "Custom Title", (
            "custom insurance config must not be overwritten"
        )
        assert tc["insurance"]["benefits"] == ["Custom benefit"], (
            "custom benefits must not be overwritten"
        )

        conn.exec_driver_sql(f"DROP TABLE ticketingsteps_{suffix}")
        conn.exec_driver_sql(f"DROP TABLE popups_{suffix}")

    def test_confirm_step_json_null_template_config_gets_defaults(
        self, db: Session
    ) -> None:
        """Batch4 regression: confirm step with JSON null (not SQL NULL) template_config
        must still get the defaults, not produce `[null, {obj}]` via `||` wrapping."""
        conn = db.connection()
        suffix = "b4_jsonnull"
        _setup_temp_tables(conn, suffix)

        popup_id = conn.exec_driver_sql(
            f"INSERT INTO popups_{suffix} DEFAULT VALUES RETURNING id"
        ).fetchone()[0]
        tenant_id = conn.exec_driver_sql("SELECT gen_random_uuid()").fetchone()[0]

        # Insert JSON null (not SQL NULL) — common in existing seeds
        conn.exec_driver_sql(
            f"""
            INSERT INTO ticketingsteps_{suffix} (popup_id, tenant_id, step_type, template_config)
            VALUES (%s, %s, 'confirm', 'null'::jsonb)
            """,
            (popup_id, tenant_id),
        )

        _run_migration_sql(conn, suffix)

        row = conn.exec_driver_sql(
            f"SELECT jsonb_typeof(template_config), template_config FROM ticketingsteps_{suffix} WHERE step_type = 'confirm' AND popup_id = %s",
            (popup_id,),
        ).fetchone()
        assert row[0] == "object", f"expected object, got {row[0]} with value {row[1]}"
        tc = row[1]
        assert "insurance" in tc
        assert tc["insurance"]["card_title"] == "Insurance"

        conn.exec_driver_sql(f"DROP TABLE ticketingsteps_{suffix}")
        conn.exec_driver_sql(f"DROP TABLE popups_{suffix}")

    def test_migration_is_idempotent(self, db: Session) -> None:
        """Batch4: running migration twice produces same result."""
        conn = db.connection()
        suffix = "b4_idem"
        _setup_temp_tables(conn, suffix)

        popup_id = conn.exec_driver_sql(
            f"INSERT INTO popups_{suffix} DEFAULT VALUES RETURNING id"
        ).fetchone()[0]
        tenant_id = conn.exec_driver_sql("SELECT gen_random_uuid()").fetchone()[0]

        conn.exec_driver_sql(
            f"""
            INSERT INTO ticketingsteps_{suffix} (popup_id, tenant_id, step_type)
            VALUES (%s, %s, 'confirm')
            """,
            (popup_id, tenant_id),
        )

        _run_migration_sql(conn, suffix)
        _run_migration_sql(conn, suffix)

        row = conn.exec_driver_sql(
            f"SELECT template_config FROM ticketingsteps_{suffix} WHERE step_type = 'confirm' AND popup_id = %s",
            (popup_id,),
        ).fetchone()
        tc = row[0]
        assert "insurance" in tc

        # Count confirm rows — must still be exactly 1
        count = conn.exec_driver_sql(
            f"SELECT COUNT(*) FROM ticketingsteps_{suffix} WHERE step_type = 'confirm' AND popup_id = %s",
            (popup_id,),
        ).fetchone()[0]
        assert count == 1, f"Expected 1 confirm row, got {count}"

        conn.exec_driver_sql(f"DROP TABLE ticketingsteps_{suffix}")
        conn.exec_driver_sql(f"DROP TABLE popups_{suffix}")
