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


def public_display_name(first_name: str | None, last_name: str | None) -> str | None:
    """Name shown on a public share page: first name plus last initial.

    Falls back to whichever part exists; None when the human has no name, so
    the page can show its own placeholder instead of leaking the email.
    """
    first = (first_name or "").strip()
    last = (last_name or "").strip()
    if first and last:
        return f"{first} {last[0].upper()}."
    return first or last or None
