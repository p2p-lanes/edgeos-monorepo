"""Badge rules: composable conditions.

A rule's config becomes a list of conditions that must all hold, each with
an activity (attend or host), filters (popup, tracks, tags, kinds, venues,
events, weekdays, time of day, dates) and a measure (occurrences, distinct
days, longest streak). The two original rule kinds map onto it exactly:

* checkins_in_track -> attend, count, filtered by that track
* checkins_in_popup -> attend, count, filtered by that popup

Downgrade turns single-condition rules of those two shapes back; any other
rule can't be expressed in the old format and is deleted (awards it gave
keep their ``rule_id`` set to NULL by the foreign key).
"""

import json

import sqlalchemy as sa
from alembic import op

revision = "e5a1c3d7f9b2"
down_revision = "d4f8b2c6e9a1"
branch_labels = None
depends_on = None


def _condition(threshold: int, filters: dict) -> dict:
    return {
        "conditions": [
            {
                "activity": "attend",
                "measure": "count",
                "threshold": threshold,
                "filters": filters,
            }
        ]
    }


LEGACY_TYPES = "type IN ('checkins_in_track', 'checkins_in_popup')"


def upgrade():
    op.drop_constraint("ck_badge_rules_type", "badge_rules", type_="check")
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id, type, config FROM badge_rules")).all()
    for rule_id, rule_type, config in rows:
        if rule_type == "checkins_in_track":
            new = _condition(config["threshold"], {"track_ids": [config["track_id"]]})
        elif rule_type == "checkins_in_popup":
            new = _condition(config["threshold"], {"popup_id": config["popup_id"]})
        else:
            continue
        conn.execute(
            sa.text(
                "UPDATE badge_rules SET type = 'conditions',"
                " config = CAST(:config AS jsonb) WHERE id = :id"
            ),
            {"config": json.dumps(new), "id": rule_id},
        )
    op.create_check_constraint(
        "ck_badge_rules_type", "badge_rules", "type = 'conditions'"
    )


def _legacy(config: dict) -> tuple[str, dict] | None:
    conditions = config.get("conditions") or []
    if len(conditions) != 1:
        return None
    condition = conditions[0]
    if condition.get("activity") != "attend" or condition.get("measure") != "count":
        return None
    filters = {k: v for k, v in (condition.get("filters") or {}).items() if v}
    threshold = condition["threshold"]
    tracks = filters.pop("track_ids", None)
    popup = filters.pop("popup_id", None)
    filters.pop("tags_match", None)
    if filters:
        return None
    if tracks and len(tracks) == 1 and not popup:
        return "checkins_in_track", {
            "type": "checkins_in_track",
            "track_id": tracks[0],
            "threshold": threshold,
        }
    if popup and not tracks:
        return "checkins_in_popup", {
            "type": "checkins_in_popup",
            "popup_id": popup,
            "threshold": threshold,
        }
    return None


def downgrade():
    op.drop_constraint("ck_badge_rules_type", "badge_rules", type_="check")
    conn = op.get_bind()
    rows = conn.execute(
        sa.text("SELECT id, config FROM badge_rules WHERE type = 'conditions'")
    ).all()
    for rule_id, config in rows:
        legacy = _legacy(config)
        if legacy is None:
            conn.execute(
                sa.text("DELETE FROM badge_rules WHERE id = :id"), {"id": rule_id}
            )
            continue
        rule_type, old = legacy
        conn.execute(
            sa.text(
                "UPDATE badge_rules SET type = :type,"
                " config = CAST(:config AS jsonb) WHERE id = :id"
            ),
            {"type": rule_type, "config": json.dumps(old), "id": rule_id},
        )
    op.create_check_constraint("ck_badge_rules_type", "badge_rules", LEGACY_TYPES)
