"""Restriction rule schema (sdd/sales-flows design, G3 checkpoint 12.8 —
CONFIRMED 2026-08-04).

CLOSED predicate set (G3 #1, binding — never a DSL, never user-configurable):
``form_answer``, ``human_profile_field``, ``has_purchased`` (product|category).
An AND/OR tree over these three. Adding a fourth predicate is a future SDD
change, never a runtime configuration knob.

CLOSED op set (5): ``eq``, ``neq``, ``in``, ``not_in``, ``exists``.

Pure module — no I/O, no session. `context.py` owns resolution, `evaluator.py`
owns tree evaluation.
"""

from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

# Sentinel returned by `PurchaseContext` resolver methods when a predicate
# cannot be resolved in the current request (e.g. `human_profile_field` with
# no authenticated human, or `form_answer` with no buyer form data yet). The
# evaluator's fail-closed rule keys off `is UNRESOLVED`, never a bare `None`
# — `None` is a legitimate resolved value (e.g. a profile field left blank).
UNRESOLVED = object()


class RestrictionOp(StrEnum):
    """Closed op set (5). No arithmetic/comparison operators beyond these —
    this is a membership/equality gate, not an expression language."""

    eq = "eq"
    neq = "neq"
    in_ = "in"
    not_in = "not_in"
    exists = "exists"


class RestrictionPredicateKind(StrEnum):
    """Closed predicate set (3, G3 #1 binding)."""

    form_answer = "form_answer"
    human_profile_field = "human_profile_field"
    has_purchased = "has_purchased"


class HasPurchasedScope(StrEnum):
    product = "product"
    category = "category"


# Allowlist of `Humans` profile attributes a `human_profile_field` predicate
# may reference. Closed set — never arbitrary column/attribute access.
# Excludes `enriched_profile` (agent-curated, not a simple scalar match) and
# `picture_url` (not a meaningful restriction dimension).
HUMAN_PROFILE_FIELDS: frozenset[str] = frozenset(
    {
        "email",
        "first_name",
        "last_name",
        "telegram",
        "gender",
        "age",
        "residence",
        "rating",
        "red_flag",
    }
)


class FormAnswerLeaf(BaseModel):
    """Matches a value the buyer submitted on the flow's buyer form
    (`obj.buyer.form_data` on the anonymous path, `application.custom_fields`
    on the authenticated path)."""

    kind: Literal[RestrictionPredicateKind.form_answer] = (
        RestrictionPredicateKind.form_answer
    )
    field_name: str
    op: RestrictionOp
    value: Any = None
    negate: bool = False

    model_config = ConfigDict(extra="forbid")


class HumanProfileFieldLeaf(BaseModel):
    """Matches an allowlisted `Humans` profile attribute.

    Rejected at flow save time (422) for `type=direct` flows — a direct-type
    flow has no `Humans` row for an anonymous buyer, so this predicate would
    always be unresolvable and, under fail-closed, silently block every
    anonymous buyer. See `assert_restriction_rule_allowed_for_type`.
    """

    kind: Literal[RestrictionPredicateKind.human_profile_field] = (
        RestrictionPredicateKind.human_profile_field
    )
    field: str
    op: RestrictionOp
    value: Any = None
    negate: bool = False

    model_config = ConfigDict(extra="forbid")

    @model_validator(mode="after")
    def _field_is_allowlisted(self) -> "HumanProfileFieldLeaf":
        if self.field not in HUMAN_PROFILE_FIELDS:
            raise ValueError(
                f"human_profile_field '{self.field}' is not an allowlisted "
                f"Humans attribute. Allowed: {sorted(HUMAN_PROFILE_FIELDS)}"
            )
        return self


class HasPurchasedLeaf(BaseModel):
    """Has the buyer previously received an APPROVED payment for the given
    product or category, anywhere in the popup (matches the upsale
    eligibility precedent — `sales_flow/eligibility.py`)."""

    kind: Literal[RestrictionPredicateKind.has_purchased] = (
        RestrictionPredicateKind.has_purchased
    )
    scope: HasPurchasedScope
    value: str
    op: RestrictionOp = RestrictionOp.exists
    negate: bool = False

    model_config = ConfigDict(extra="forbid")


RestrictionLeaf = Annotated[
    FormAnswerLeaf | HumanProfileFieldLeaf | HasPurchasedLeaf,
    Field(discriminator="kind"),
]


class RestrictionAllOf(BaseModel):
    all_of: list["RestrictionNode"] = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")


class RestrictionAnyOf(BaseModel):
    any_of: list["RestrictionNode"] = Field(min_length=1)

    model_config = ConfigDict(extra="forbid")


RestrictionNode = RestrictionAllOf | RestrictionAnyOf | RestrictionLeaf

RestrictionAllOf.model_rebuild()
RestrictionAnyOf.model_rebuild()

_RESTRICTION_NODE_ADAPTER: TypeAdapter[RestrictionNode] = TypeAdapter(RestrictionNode)


def parse_restriction_rule(data: dict) -> RestrictionNode:
    """Parse and structurally validate a `restriction_rule` JSONB payload.

    Raises `pydantic.ValidationError` (surfaced as a 422 by FastAPI/pydantic
    at the schema boundary) on any shape outside the closed predicate/op set.
    """
    return _RESTRICTION_NODE_ADAPTER.validate_python(data)


def iter_leaves(node: RestrictionNode) -> "list[RestrictionLeafUnion]":
    """Flatten every leaf predicate out of an AND/OR tree (save-time
    validation only — the evaluator never needs this, it recurses itself)."""
    if isinstance(node, RestrictionAllOf):
        leaves: list[RestrictionLeafUnion] = []
        for child in node.all_of:
            leaves.extend(iter_leaves(child))
        return leaves
    if isinstance(node, RestrictionAnyOf):
        leaves = []
        for child in node.any_of:
            leaves.extend(iter_leaves(child))
        return leaves
    return [node]


RestrictionLeafUnion = FormAnswerLeaf | HumanProfileFieldLeaf | HasPurchasedLeaf


def assert_restriction_rule_allowed_for_type(
    rule_data: dict | None, *, flow_type: str
) -> None:
    """Save-time guard (G3 #1 anonymous-buyer safety): a `type=direct` flow
    has no `Humans` row for an anonymous buyer, so a `human_profile_field`
    predicate there is unresolvable and, under fail-closed evaluation, would
    silently block every anonymous buyer. Reject (raise `ValueError`, surfaced
    as 422) instead of shipping a rule that can never pass.

    No-op when `rule_data` is None (feature off) or `flow_type != "direct"`.
    """
    if rule_data is None or flow_type != "direct":
        return
    node = parse_restriction_rule(rule_data)
    if any(isinstance(leaf, HumanProfileFieldLeaf) for leaf in iter_leaves(node)):
        raise ValueError(
            "restriction_rule cannot use human_profile_field on a "
            "type=direct flow: anonymous buyers have no profile to match "
            "against, so this predicate would block every buyer."
        )
