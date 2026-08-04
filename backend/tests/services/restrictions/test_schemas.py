"""Unit tests (no DB) for the restriction rule schema — the closed
predicate/op set (G3 #1, confirmed 2026-08-04) and the direct-flow
`human_profile_field` save-time guard.
"""

import pytest
from pydantic import ValidationError

from app.services.restrictions.schemas import (
    FormAnswerLeaf,
    HasPurchasedLeaf,
    HumanProfileFieldLeaf,
    RestrictionAllOf,
    RestrictionAnyOf,
    assert_restriction_rule_allowed_for_type,
    iter_leaves,
    parse_restriction_rule,
)


class TestParseRestrictionRule:
    def test_parses_bare_form_answer_leaf(self) -> None:
        node = parse_restriction_rule(
            {"kind": "form_answer", "field_name": "country", "op": "eq", "value": "AR"}
        )
        assert isinstance(node, FormAnswerLeaf)
        assert node.field_name == "country"

    def test_parses_bare_human_profile_field_leaf(self) -> None:
        node = parse_restriction_rule(
            {
                "kind": "human_profile_field",
                "field": "residence",
                "op": "eq",
                "value": "AR",
            }
        )
        assert isinstance(node, HumanProfileFieldLeaf)

    def test_parses_bare_has_purchased_leaf(self) -> None:
        node = parse_restriction_rule(
            {"kind": "has_purchased", "scope": "product", "value": "abc-123"}
        )
        assert isinstance(node, HasPurchasedLeaf)
        assert node.op == "exists"

    def test_parses_nested_all_of_any_of_tree(self) -> None:
        node = parse_restriction_rule(
            {
                "all_of": [
                    {"kind": "form_answer", "field_name": "x", "op": "exists"},
                    {
                        "any_of": [
                            {
                                "kind": "has_purchased",
                                "scope": "category",
                                "value": "ticket",
                            },
                            {
                                "kind": "human_profile_field",
                                "field": "email",
                                "op": "neq",
                                "value": "x@test.com",
                            },
                        ]
                    },
                ]
            }
        )
        assert isinstance(node, RestrictionAllOf)
        assert isinstance(node.all_of[1], RestrictionAnyOf)

    def test_rejects_unknown_predicate_kind(self) -> None:
        with pytest.raises(ValidationError):
            parse_restriction_rule({"kind": "arbitrary_sql", "op": "eq"})

    def test_rejects_unknown_op(self) -> None:
        with pytest.raises(ValidationError):
            parse_restriction_rule(
                {"kind": "form_answer", "field_name": "x", "op": "greater_than"}
            )

    def test_rejects_non_allowlisted_human_profile_field(self) -> None:
        with pytest.raises(ValidationError):
            parse_restriction_rule(
                {
                    "kind": "human_profile_field",
                    "field": "enriched_profile",
                    "op": "exists",
                }
            )

    def test_rejects_extra_unknown_keys(self) -> None:
        with pytest.raises(ValidationError):
            parse_restriction_rule(
                {
                    "kind": "form_answer",
                    "field_name": "x",
                    "op": "exists",
                    "expression": "1 == 1",
                }
            )

    def test_rejects_empty_all_of(self) -> None:
        with pytest.raises(ValidationError):
            parse_restriction_rule({"all_of": []})


class TestIterLeaves:
    def test_flattens_nested_tree(self) -> None:
        node = parse_restriction_rule(
            {
                "all_of": [
                    {"kind": "form_answer", "field_name": "a", "op": "exists"},
                    {
                        "any_of": [
                            {
                                "kind": "has_purchased",
                                "scope": "product",
                                "value": "p1",
                            },
                            {
                                "kind": "human_profile_field",
                                "field": "email",
                                "op": "exists",
                            },
                        ]
                    },
                ]
            }
        )
        leaves = iter_leaves(node)
        assert len(leaves) == 3


class TestAssertRestrictionRuleAllowedForType:
    def test_noop_when_rule_is_none(self) -> None:
        assert_restriction_rule_allowed_for_type(None, flow_type="direct")

    def test_noop_for_non_direct_flow_type(self) -> None:
        rule = {"kind": "human_profile_field", "field": "email", "op": "exists"}
        assert_restriction_rule_allowed_for_type(rule, flow_type="application")
        assert_restriction_rule_allowed_for_type(rule, flow_type="upsale")

    def test_rejects_human_profile_field_on_direct_flow(self) -> None:
        rule = {"kind": "human_profile_field", "field": "email", "op": "exists"}
        with pytest.raises(ValueError, match="human_profile_field"):
            assert_restriction_rule_allowed_for_type(rule, flow_type="direct")

    def test_rejects_nested_human_profile_field_on_direct_flow(self) -> None:
        rule = {
            "all_of": [
                {"kind": "form_answer", "field_name": "x", "op": "exists"},
                {"kind": "human_profile_field", "field": "email", "op": "exists"},
            ]
        }
        with pytest.raises(ValueError, match="human_profile_field"):
            assert_restriction_rule_allowed_for_type(rule, flow_type="direct")

    def test_allows_form_answer_and_has_purchased_on_direct_flow(self) -> None:
        rule = {
            "all_of": [
                {"kind": "form_answer", "field_name": "x", "op": "exists"},
                {"kind": "has_purchased", "scope": "product", "value": "p1"},
            ]
        }
        assert_restriction_rule_allowed_for_type(rule, flow_type="direct")
