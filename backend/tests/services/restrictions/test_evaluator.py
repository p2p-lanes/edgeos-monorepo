"""Unit tests (no DB) for the pure restriction evaluator (design D5).

Uses a lightweight fake context (not `PurchaseContext`) so this module stays
fast and DB-free, mirroring `services/approval/calculator.py`'s own
table-driven test style.
"""

from dataclasses import dataclass, field
from types import SimpleNamespace
from typing import Any

from app.services.restrictions.context import PurchaseContext
from app.services.restrictions.enforcement import _restriction_passes
from app.services.restrictions.evaluator import evaluate
from app.services.restrictions.schemas import UNRESOLVED, parse_restriction_rule


@dataclass
class FakeContext:
    form_answers: dict[str, Any] = field(default_factory=dict)
    human_fields: dict[str, Any] = field(default_factory=dict)
    purchases: dict[tuple[str, str], Any] = field(default_factory=dict)

    def form_answer(self, field_name: str) -> Any:
        return self.form_answers.get(field_name, UNRESOLVED)

    def human_profile_field(self, field_name: str) -> Any:
        return self.human_fields.get(field_name, UNRESOLVED)

    def has_purchased(self, scope: str, value: str) -> Any:
        return self.purchases.get((scope, value), UNRESOLVED)


def _leaf(**kwargs):
    return parse_restriction_rule(kwargs)


class TestFormAnswerPredicate:
    def test_eq_true(self) -> None:
        node = _leaf(kind="form_answer", field_name="country", op="eq", value="AR")
        ctx = FakeContext(form_answers={"country": "AR"})
        assert evaluate(node, ctx) is True

    def test_eq_false(self) -> None:
        node = _leaf(kind="form_answer", field_name="country", op="eq", value="AR")
        ctx = FakeContext(form_answers={"country": "US"})
        assert evaluate(node, ctx) is False

    def test_neq(self) -> None:
        node = _leaf(kind="form_answer", field_name="country", op="neq", value="AR")
        ctx = FakeContext(form_answers={"country": "US"})
        assert evaluate(node, ctx) is True

    def test_in(self) -> None:
        node = _leaf(
            kind="form_answer", field_name="country", op="in", value=["AR", "UY"]
        )
        ctx = FakeContext(form_answers={"country": "AR"})
        assert evaluate(node, ctx) is True

    def test_not_in(self) -> None:
        node = _leaf(
            kind="form_answer", field_name="country", op="not_in", value=["AR", "UY"]
        )
        ctx = FakeContext(form_answers={"country": "US"})
        assert evaluate(node, ctx) is True

    def test_exists_true_for_truthy_value(self) -> None:
        node = _leaf(kind="form_answer", field_name="country", op="exists")
        ctx = FakeContext(form_answers={"country": "AR"})
        assert evaluate(node, ctx) is True

    def test_exists_false_for_missing_field(self) -> None:
        node = _leaf(kind="form_answer", field_name="country", op="exists")
        ctx = FakeContext()
        assert evaluate(node, ctx) is False

    def test_negate_flips_result(self) -> None:
        node = _leaf(
            kind="form_answer", field_name="country", op="eq", value="AR", negate=True
        )
        ctx = FakeContext(form_answers={"country": "AR"})
        assert evaluate(node, ctx) is False


class TestHumanProfileFieldPredicate:
    def test_eq_true(self) -> None:
        node = _leaf(kind="human_profile_field", field="residence", op="eq", value="AR")
        ctx = FakeContext(human_fields={"residence": "AR"})
        assert evaluate(node, ctx) is True

    def test_unresolved_when_no_human_fails_closed(self) -> None:
        node = _leaf(kind="human_profile_field", field="residence", op="eq", value="AR")
        ctx = FakeContext()  # no human -> UNRESOLVED
        assert evaluate(node, ctx) is False

    def test_unresolved_with_negate_still_fails_closed(self) -> None:
        """The critical fail-closed property: negate must never turn an
        unresolvable predicate into an allow."""
        node = _leaf(
            kind="human_profile_field",
            field="residence",
            op="eq",
            value="AR",
            negate=True,
        )
        ctx = FakeContext()  # no human -> UNRESOLVED
        assert evaluate(node, ctx) is False


_PRODUCT_ID = "11111111-1111-1111-1111-111111111111"


class TestHasPurchasedPredicate:
    def test_exists_true_when_purchased(self) -> None:
        node = _leaf(kind="has_purchased", scope="product", value=_PRODUCT_ID)
        ctx = FakeContext(purchases={("product", _PRODUCT_ID): True})
        assert evaluate(node, ctx) is True

    def test_exists_false_when_not_purchased(self) -> None:
        node = _leaf(kind="has_purchased", scope="product", value=_PRODUCT_ID)
        ctx = FakeContext(purchases={("product", _PRODUCT_ID): False})
        assert evaluate(node, ctx) is False

    def test_negate_means_has_not_purchased(self) -> None:
        node = _leaf(
            kind="has_purchased", scope="category", value="ticket", negate=True
        )
        ctx = FakeContext(purchases={("category", "ticket"): False})
        assert evaluate(node, ctx) is True

    def test_unresolved_fails_closed(self) -> None:
        node = _leaf(kind="has_purchased", scope="product", value=_PRODUCT_ID)
        ctx = FakeContext()  # no cached answer -> UNRESOLVED
        assert evaluate(node, ctx) is False


class TestPurchaseContextBackstops:
    """risk-001/rel-002: has_purchased fails closed, never raises."""

    def test_no_authenticated_human_fails_closed(self) -> None:
        ctx = PurchaseContext(  # type: ignore[arg-type]
            session=None, popup=None, flow=None, human=None, buyer_email="x@test.com"
        )
        assert ctx.has_purchased("product", _PRODUCT_ID) is UNRESOLVED

    def test_non_uuid_product_value_fails_closed(self) -> None:
        ctx = PurchaseContext(  # type: ignore[arg-type]
            session=None,
            popup=None,
            flow=SimpleNamespace(id="flow-1"),
            human=SimpleNamespace(id="human-1"),
        )
        assert ctx.has_purchased("product", "not-a-uuid") is UNRESOLVED

    def test_malformed_restriction_rule_denies(self) -> None:
        flow = SimpleNamespace(id="flow-1", restriction_rule={"kind": "arbitrary_sql"})
        assert _restriction_passes(flow, context=None) is False


class TestAllOfAnyOf:
    def test_all_of_requires_every_child_true(self) -> None:
        node = parse_restriction_rule(
            {
                "all_of": [
                    {"kind": "form_answer", "field_name": "a", "op": "exists"},
                    {"kind": "form_answer", "field_name": "b", "op": "exists"},
                ]
            }
        )
        ctx = FakeContext(form_answers={"a": "x", "b": "y"})
        assert evaluate(node, ctx) is True

        ctx_missing_one = FakeContext(form_answers={"a": "x"})
        assert evaluate(node, ctx_missing_one) is False

    def test_any_of_requires_one_child_true(self) -> None:
        node = parse_restriction_rule(
            {
                "any_of": [
                    {"kind": "form_answer", "field_name": "a", "op": "exists"},
                    {"kind": "form_answer", "field_name": "b", "op": "exists"},
                ]
            }
        )
        ctx = FakeContext(form_answers={"b": "y"})
        assert evaluate(node, ctx) is True

        ctx_neither = FakeContext()
        assert evaluate(node, ctx_neither) is False

    def test_nested_tree_short_circuits_on_unresolved(self) -> None:
        """all_of([resolvable_true, unresolvable]) -> False (fail closed),
        never raises, never treats an unresolved leaf as vacuously true."""
        node = parse_restriction_rule(
            {
                "all_of": [
                    {"kind": "form_answer", "field_name": "a", "op": "exists"},
                    {"kind": "human_profile_field", "field": "email", "op": "exists"},
                ]
            }
        )
        ctx = FakeContext(form_answers={"a": "x"})  # no human -> second leaf UNRESOLVED
        assert evaluate(node, ctx) is False
