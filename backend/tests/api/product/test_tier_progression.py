"""Unit tests for derive_phase_states — SP-2 progression derivation rules.

These are pure unit tests: no DB, no fixtures.
They import a function that does NOT yet exist, so they fail on import (RED).
"""

from datetime import UTC, datetime
from unittest.mock import MagicMock

from app.api.product.tier_progression import derive_phase_states

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _phase(
    id_n: int,
    order: int,
    sale_starts_at: datetime | None = None,
    sale_ends_at: datetime | None = None,
    max_quantity: int | None = None,
) -> MagicMock:
    """Build a minimal TicketTierPhase-like mock."""
    ph = MagicMock()
    ph.id = id_n
    ph.order = order
    ph.sale_starts_at = sale_starts_at
    ph.sale_ends_at = sale_ends_at
    # Embed max_quantity via the linked product mock
    ph.product = MagicMock()
    ph.product.max_quantity = max_quantity
    return ph


def _group(shared_stock_remaining: int | None = None) -> MagicMock:
    grp = MagicMock()
    grp.shared_stock_remaining = shared_stock_remaining
    return grp


def _sold(product_id_n: int, qty: int) -> dict:
    return {"product_id": product_id_n, "sold": qty}


T = datetime(2026, 6, 1, 12, 0, tzinfo=UTC)
BEFORE_T = datetime(2026, 5, 1, 12, 0, tzinfo=UTC)
AFTER_T = datetime(2026, 7, 1, 12, 0, tzinfo=UTC)


# ---------------------------------------------------------------------------
# SP-2 — Derivation rules
# ---------------------------------------------------------------------------


class TestDerivePhaseStatesRules:
    """Cover all SP-2 rule branches in isolation."""

    def test_null_windows_gives_available(self) -> None:
        """No sale window + no cap → available."""
        group = _group()
        phase = _phase(1, order=1)  # no windows, no max_quantity
        result = derive_phase_states(group, [phase], now=T, sold_counts={})

        assert len(result) == 1
        assert result[0].sales_state == "available"
        assert result[0].is_purchasable is True

    def test_expired_when_now_gte_sale_ends_at(self) -> None:
        """sale_ends_at in past → expired."""
        group = _group()
        phase = _phase(1, order=1, sale_ends_at=BEFORE_T)
        result = derive_phase_states(group, [phase], now=T, sold_counts={})

        assert result[0].sales_state == "expired"
        assert result[0].is_purchasable is False

    def test_upcoming_when_now_lt_sale_starts_at(self) -> None:
        """sale_starts_at in future → upcoming."""
        group = _group()
        phase = _phase(1, order=1, sale_starts_at=AFTER_T)
        result = derive_phase_states(group, [phase], now=T, sold_counts={})

        assert result[0].sales_state == "upcoming"
        assert result[0].is_purchasable is False

    def test_phase_cap_exhausted_gives_sold_out(self) -> None:
        """max_quantity sold in full → sold_out (phase-level cap)."""
        group = _group()
        phase = _phase(1, order=1, max_quantity=10)
        result = derive_phase_states(group, [phase], now=T, sold_counts={1: 10})

        assert result[0].sales_state == "sold_out"
        assert result[0].is_purchasable is False

    def test_shared_cap_zero_gives_sold_out(self) -> None:
        """shared_stock_remaining=0 → sold_out even if phase has capacity."""
        group = _group(shared_stock_remaining=0)
        phase = _phase(1, order=1, max_quantity=100)
        result = derive_phase_states(group, [phase], now=T, sold_counts={1: 0})

        assert result[0].sales_state == "sold_out"
        assert result[0].is_purchasable is False

    def test_shared_cap_none_does_not_block(self) -> None:
        """shared_stock_remaining=None means no shared cap → falls through to available."""
        group = _group(shared_stock_remaining=None)
        phase = _phase(1, order=1)
        result = derive_phase_states(group, [phase], now=T, sold_counts={})

        assert result[0].sales_state == "available"
        assert result[0].is_purchasable is True


# ---------------------------------------------------------------------------
# SP-3 — Exactly-one is_purchasable invariant
# ---------------------------------------------------------------------------


class TestExactlyOnePurchasable:
    def test_first_available_is_purchasable(self) -> None:
        """With three phases, first eligible gets is_purchasable=True."""
        group = _group()
        phases = [
            _phase(1, order=1, sale_ends_at=BEFORE_T),  # expired
            _phase(2, order=2),  # available
            _phase(3, order=3),  # available
        ]
        result = derive_phase_states(group, phases, now=T, sold_counts={})

        states = {r.order: r for r in result}
        assert states[1].sales_state == "expired"
        assert states[1].is_purchasable is False
        assert states[2].sales_state == "available"
        assert states[2].is_purchasable is True
        assert states[3].sales_state == "available"
        assert states[3].is_purchasable is False

    def test_zero_purchasable_when_all_expired(self) -> None:
        """All expired → zero is_purchasable."""
        group = _group()
        phases = [
            _phase(1, order=1, sale_ends_at=BEFORE_T),
            _phase(2, order=2, sale_ends_at=BEFORE_T),
        ]
        result = derive_phase_states(group, phases, now=T, sold_counts={})

        assert all(not r.is_purchasable for r in result)
        assert all(r.sales_state == "expired" for r in result)

    def test_zero_purchasable_when_all_upcoming(self) -> None:
        """All upcoming → zero is_purchasable."""
        group = _group()
        phases = [
            _phase(1, order=1, sale_starts_at=AFTER_T),
            _phase(2, order=2, sale_starts_at=AFTER_T),
        ]
        result = derive_phase_states(group, phases, now=T, sold_counts={})

        assert all(not r.is_purchasable for r in result)
        assert all(r.sales_state == "upcoming" for r in result)

    def test_zero_purchasable_when_all_sold_out(self) -> None:
        """All sold out → zero is_purchasable."""
        group = _group(shared_stock_remaining=0)
        phases = [
            _phase(1, order=1),
            _phase(2, order=2),
        ]
        result = derive_phase_states(group, phases, now=T, sold_counts={})

        assert all(not r.is_purchasable for r in result)
        assert all(r.sales_state == "sold_out" for r in result)


# ---------------------------------------------------------------------------
# SP-5 — Overlapping windows: lowest-order wins
# ---------------------------------------------------------------------------


class TestOverlappingWindows:
    def test_overlapping_both_available_lowest_order_wins(self) -> None:
        """Two simultaneously-available phases → lowest order is purchasable."""
        group = _group()
        # Both windows are open at T
        phases = [
            _phase(1, order=1, sale_starts_at=BEFORE_T, sale_ends_at=AFTER_T),
            _phase(2, order=2, sale_starts_at=BEFORE_T, sale_ends_at=AFTER_T),
        ]
        result = derive_phase_states(group, phases, now=T, sold_counts={})

        states = {r.order: r for r in result}
        assert states[1].sales_state == "available"
        assert states[1].is_purchasable is True
        assert states[2].sales_state == "available"
        assert states[2].is_purchasable is False

    def test_overlap_with_three_phases_middle_purchasable(self) -> None:
        """First expired, two remaining both open → order=2 wins."""
        group = _group()
        phases = [
            _phase(1, order=1, sale_ends_at=BEFORE_T),  # expired
            _phase(2, order=2, sale_starts_at=BEFORE_T),  # available
            _phase(3, order=3, sale_starts_at=BEFORE_T),  # available
        ]
        result = derive_phase_states(group, phases, now=T, sold_counts={})

        states = {r.order: r for r in result}
        assert states[1].is_purchasable is False
        assert states[2].is_purchasable is True
        assert states[3].is_purchasable is False


# ---------------------------------------------------------------------------
# Edge: empty phase list
# ---------------------------------------------------------------------------


def test_empty_phases_returns_empty() -> None:
    group = _group()
    result = derive_phase_states(group, [], now=T, sold_counts={})
    assert result == []


# ---------------------------------------------------------------------------
# Returned objects carry order field
# ---------------------------------------------------------------------------


def test_result_order_matches_input_order() -> None:
    """Results must carry the order attribute of each phase."""
    group = _group()
    phases = [_phase(10, order=3), _phase(20, order=1), _phase(30, order=2)]
    result = derive_phase_states(group, phases, now=T, sold_counts={})
    orders = [r.order for r in result]
    assert sorted(orders) == [1, 2, 3]
