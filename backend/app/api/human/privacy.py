"""Reserved human assessment fields at public profile-metadata boundaries.

Only the root of a profile snapshot is filtered: arbitrary nested form answers
are not human assessments. Never mutate the input or stored historical data.
"""

ADMIN_PROFILE_FIELDS = frozenset({"rating", "red_flag", "enriched_profile"})


def public_profile_metadata(value: dict | None) -> dict:
    return {
        key: item
        for key, item in (value or {}).items()
        if key not in ADMIN_PROFILE_FIELDS
    }
