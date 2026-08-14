"""What a way in starts with when it is not copied from an existing one.

These are deliberately thin, and the reason is worth stating because the file
otherwise looks unfinished.

The value of starting fresh is not in what a template sets. It is in what it
does NOT bring: a partner door's five percent contribution, its six-month
installment plan, its refusal of coupons. Someone opening a volunteers door on
that gathering wants none of it, and before this the only way to avoid it was
to notice each inherited setting and undo it one by one.

So a template holds the few defaults that are safe to apply without anyone
having asked for them. That rules out most settings on purpose:

  - anything that charges money — insurance, contribution, installments
  - anything that sends email — every reminder cadence
  - anything an organiser must supply — landing URLs, signing secrets

A default that quietly bills a buyer or mails an applicant is not a
convenience. What is missing is offered by the editor instead, where it is a
suggestion somebody accepts rather than a decision made on their behalf.

Templates live in code rather than a table because they are defaults, and
defaults belong where they are reviewed in a pull request and versioned with
the code that reads them. A per-tenant templates table would be a second
source of truth that drifts. "Save this door as a template" already exists
under another name: copy an existing door.
"""

from dataclasses import dataclass, field
from typing import Any

from app.api.sales_flow.schemas import (
    EFFECTIVE_CONFIG_FIELDS,
    SalesFlowType,
    fields_for,
)
from app.api.shared.enums import ApplicationLayout


@dataclass(frozen=True)
class FlowTemplate:
    """The starting configuration for a way in of one kind.

    `values` names only the columns it sets. Everything else stays NULL, which
    is the honest state for a setting nobody has decided yet.
    """

    flow_type: str
    values: dict[str, Any] = field(default_factory=dict)


FLOW_TEMPLATES: dict[str, FlowTemplate] = {
    SalesFlowType.application.value: FlowTemplate(
        flow_type=SalesFlowType.application.value,
        values={
            # A form of any length reads better in steps, and a single page is
            # one click away for anyone who disagrees.
            "application_layout": ApplicationLayout.multi_step.value,
            "allows_coupons": True,
        },
    ),
    SalesFlowType.direct.value: FlowTemplate(
        flow_type=SalesFlowType.direct.value,
        values={"allows_coupons": True},
    ),
    SalesFlowType.upsale.value: FlowTemplate(
        flow_type=SalesFlowType.upsale.value,
        values={"allows_coupons": True},
        # No restriction rule, deliberately. An upsale already refuses anyone
        # without an approved payment in this gathering (`assert_upsale_eligible`),
        # so the door is gated by construction. A default rule naming a product
        # category would be a guess about this tenant's catalogue, and a rule
        # that matches nothing fails closed — every buyer turned away, silently.
        # Visibility is left to the caller for the same reason it always was:
        # `SalesFlowCreate` already carries an explicit value for it.
    ),
}


def template_for(flow_type: str | None) -> FlowTemplate | None:
    """The template for a kind of way in, or None if there is no such kind."""
    if flow_type is None:
        return None
    return FLOW_TEMPLATES.get(str(flow_type))


def template_values(flow_type: str | None) -> dict[str, Any]:
    """A template's values, narrowed to what this kind of flow can read.

    Narrowed rather than trusted: `fields_for` is the one place that decides
    what a kind of door can use, and a template disagreeing with it would be a
    second opinion nobody asked for.
    """
    template = template_for(flow_type)
    if template is None:
        return {}
    allowed = set(fields_for(flow_type))
    return {k: v for k, v in template.values.items() if k in allowed}


# Every key a template may name. Enforced by test rather than at import, so a
# typo is a failing build rather than a setting that silently never applies.
TEMPLATABLE_FIELDS: frozenset[str] = frozenset(EFFECTIVE_CONFIG_FIELDS)
