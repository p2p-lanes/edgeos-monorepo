"""Restriction rule evaluator (sdd/sales-flows design D5).

Pure function — no I/O, no session, mirrors `services/approval/calculator.py`'s
own popup/DB-agnostic design. All resolution lives in `context.py`; this
module only walks the AND/OR tree and applies the closed op set.

Unresolvable predicate -> the WHOLE evaluation is False, regardless of
`negate` (design: "unresolvable predicate FAILS CLOSED"). This is a
deliberate security property: `negate` must never turn "we don't know" into
an allow.
"""

from typing import Any, Protocol

from app.services.restrictions.schemas import (
    UNRESOLVED,
    HasPurchasedLeaf,
    RestrictionAllOf,
    RestrictionAnyOf,
    RestrictionLeafUnion,
    RestrictionNode,
    RestrictionOp,
)


class RestrictionContext(Protocol):
    """Structural type the evaluator depends on. `context.PurchaseContext`
    implements this; a table-driven unit test may use a lightweight fake
    instead, keeping this module DB-free and fast to test."""

    def form_answer(self, field_name: str) -> Any: ...

    def human_profile_field(self, field: str) -> Any: ...

    def has_purchased(self, scope: str, value: str) -> Any: ...


def evaluate(node: RestrictionNode, context: RestrictionContext) -> bool:
    """Evaluate a restriction rule tree against `context`. Pure — same
    inputs always produce the same output."""
    if isinstance(node, RestrictionAllOf):
        return all(evaluate(child, context) for child in node.all_of)
    if isinstance(node, RestrictionAnyOf):
        return any(evaluate(child, context) for child in node.any_of)
    return _evaluate_leaf(node, context)


def _resolve_leaf(leaf: RestrictionLeafUnion, context: RestrictionContext) -> Any:
    if isinstance(leaf, HasPurchasedLeaf):
        return context.has_purchased(leaf.scope.value, leaf.value)
    if leaf.kind == "form_answer":
        return context.form_answer(leaf.field_name)
    return context.human_profile_field(leaf.field)


def _evaluate_leaf(leaf: RestrictionLeafUnion, context: RestrictionContext) -> bool:
    resolved = _resolve_leaf(leaf, context)
    if resolved is UNRESOLVED:
        return False  # fail closed — negate never applies to an unknown fact
    result = _apply_op(leaf.op, resolved, leaf.value)
    return not result if leaf.negate else result


def _apply_op(op: RestrictionOp, resolved: Any, expected: Any) -> bool:
    match op:
        case RestrictionOp.eq:
            return resolved == expected
        case RestrictionOp.neq:
            return resolved != expected
        case RestrictionOp.in_:
            return resolved in (expected or [])
        case RestrictionOp.not_in:
            return resolved not in (expected or [])
        case RestrictionOp.exists:
            return bool(resolved)
    return False  # unreachable — closed StrEnum, kept for type-checker completeness
