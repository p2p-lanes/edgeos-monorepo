"""Tier phase progression service.

Pure function — no DB access, no side effects.
Given a group, its ordered phases, the current UTC timestamp, and a dict of
sold quantities, returns a PhaseState result per phase.

Derivation rules (SP-2, evaluated in order per phase):
  1. sale_ends_at set and now >= sale_ends_at  → expired
  2. sale_starts_at set and now < sale_starts_at → upcoming
  3. phase-level stock exhausted (sold >= max_quantity) → sold_out
  4. shared group cap is 0 → sold_out
  5. otherwise → available

Exactly one phase per group has is_purchasable=True: the FIRST phase that
evaluates to "available" (lowest order). Zero phases are purchasable when all
are non-available (SP-3).

Overlapping windows are resolved deterministically by lowest order (SP-5).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class PhaseResult:
    """Derived state for a single phase.

    Attributes:
        id: Phase identifier (mirrors the input phase's id field).
        order: Sort order of the phase within the group.
        sales_state: One of "upcoming", "available", "sold_out", "expired".
        is_purchasable: True only for the single first-available phase.
        remaining: min(phase remaining, shared remaining) or None when both uncapped.
    """

    id: Any
    order: int
    sales_state: str
    is_purchasable: bool
    remaining: int | None


def derive_phase_states(
    group: Any,
    phases: list[Any],
    now: datetime,
    sold_counts: dict[Any, int],
    max_quantities: dict[Any, int | None] | None = None,
) -> list[PhaseResult]:
    """Derive sales state for every phase in a tier group.

    Args:
        group: TicketTierGroup-like object with `.shared_stock_remaining`.
        phases: List of TicketTierPhase-like objects, each with:
            `.id`, `.order`, `.sale_starts_at`, `.sale_ends_at`.
            If the object also has `.product.max_quantity` that will be used
            as a fallback when max_quantities is not supplied.
        now: Current UTC datetime (timezone-aware or naive — must match the
            timezone conventions used in sale_starts_at / sale_ends_at).
        sold_counts: Dict mapping phase.id → units already sold/pending.
        max_quantities: Optional dict mapping phase.id → max_quantity (int or None).
            When provided, takes precedence over phase.product.max_quantity.
            Use this when phase objects are ORM rows without a loaded `product`
            relationship.

    Returns:
        List of PhaseResult, one per input phase (in input order).
    """
    if not phases:
        return []

    shared_remaining: int | None = getattr(group, "shared_stock_remaining", None)

    # Sort phases by order to determine is_purchasable priority
    sorted_phases = sorted(phases, key=lambda p: p.order)

    # First pass: compute raw state for each phase
    raw_states: dict[Any, str] = {}
    for phase in sorted_phases:
        raw_states[phase.id] = _derive_single_state(
            phase, now, sold_counts, shared_remaining, max_quantities
        )

    # Identify the single purchasable phase: lowest order with state=="available"
    purchasable_id: Any = None
    for phase in sorted_phases:
        if raw_states[phase.id] == "available":
            purchasable_id = phase.id
            break

    # Build results in input order (preserve caller's ordering)
    results: list[PhaseResult] = []
    for phase in phases:
        state = raw_states[phase.id]
        remaining = _compute_remaining(
            phase, sold_counts, shared_remaining, max_quantities
        )
        results.append(
            PhaseResult(
                id=phase.id,
                order=phase.order,
                sales_state=state,
                is_purchasable=(phase.id == purchasable_id),
                remaining=remaining,
            )
        )

    return results


def _get_max_qty(
    phase: Any,
    max_quantities: dict[Any, int | None] | None,
) -> int | None:
    """Resolve max_quantity for a phase: explicit dict > phase.product.max_quantity > None."""
    if max_quantities is not None:
        return max_quantities.get(phase.id)
    # Fallback: duck-type access for mocks / objects with .product.max_quantity
    try:
        return getattr(phase.product, "max_quantity", None)
    except AttributeError:
        return None


def _derive_single_state(
    phase: Any,
    now: datetime,
    sold_counts: dict[Any, int],
    shared_remaining: int | None,
    max_quantities: dict[Any, int | None] | None = None,
) -> str:
    """Evaluate SP-2 rules for a single phase and return its sales_state string."""
    # Rule 1: expired
    if phase.sale_ends_at is not None and now >= phase.sale_ends_at:
        return "expired"

    # Rule 2: upcoming
    if phase.sale_starts_at is not None and now < phase.sale_starts_at:
        return "upcoming"

    # Rule 3: phase-level cap exhausted
    max_qty = _get_max_qty(phase, max_quantities)
    if max_qty is not None:
        sold = sold_counts.get(phase.id, 0)
        if sold >= max_qty:
            return "sold_out"

    # Rule 4: shared cap is exactly 0 (null means no cap — not sold_out)
    if shared_remaining is not None and shared_remaining == 0:
        return "sold_out"

    # Rule 5: available
    return "available"


def _compute_remaining(
    phase: Any,
    sold_counts: dict[Any, int],
    shared_remaining: int | None,
    max_quantities: dict[Any, int | None] | None = None,
) -> int | None:
    """Return min(phase_remaining, shared_remaining); None when both are uncapped."""
    max_qty = _get_max_qty(phase, max_quantities)
    phase_remaining: int | None = None
    if max_qty is not None:
        sold = sold_counts.get(phase.id, 0)
        phase_remaining = max(0, max_qty - sold)

    if phase_remaining is None and shared_remaining is None:
        return None

    if phase_remaining is None:
        return shared_remaining

    if shared_remaining is None:
        return phase_remaining

    return min(phase_remaining, shared_remaining)
