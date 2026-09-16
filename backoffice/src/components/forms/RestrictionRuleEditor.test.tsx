/**
 * Behavioral test for RestrictionRuleEditor (task 14.1).
 *
 * Deviation note (disclosed): the pure parse/serialize logic this component
 * relies on (`src/lib/salesFlowRestrictionRule.ts`) was TDD'd RED-first with
 * its own unit tests. This is a behavioral test of the component's JSX
 * composition — written after the component, approval-style, per the
 * established SalesFlowForm.override.test.tsx precedent (a genuine
 * RED-first cycle is impractical for JSX composition itself). It still
 * asserts real, non-trivial production behavior: add/remove rows, kind
 * switching resets kind-specific fields, and the unsupported-tree fallback.
 */
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import type { RestrictionLeafDraft } from "@/lib/salesFlowRestrictionRule"
import { RestrictionRuleEditor } from "./RestrictionRuleEditor"

describe("RestrictionRuleEditor", () => {
  it("renders the empty state when there are no conditions", () => {
    render(
      <RestrictionRuleEditor
        combinator="all_of"
        leaves={[]}
        unsupported={false}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/no restriction/i)).toBeInTheDocument()
  })

  it("adds a new form_answer condition row", async () => {
    const onChange = vi.fn()
    render(
      <RestrictionRuleEditor
        combinator="all_of"
        leaves={[]}
        unsupported={false}
        onChange={onChange}
      />,
    )
    await userEvent.click(
      screen.getByRole("button", { name: /add condition/i }),
    )

    expect(onChange).toHaveBeenCalledWith("all_of", [
      expect.objectContaining({ kind: "form_answer", field_name: "" }),
    ])
  })

  it("shows the combinator selector only once there are 2+ conditions", () => {
    const leaves: RestrictionLeafDraft[] = [
      {
        kind: "form_answer",
        field_name: "a",
        op: "eq",
        value: "1",
        negate: false,
      },
    ]
    const { rerender } = render(
      <RestrictionRuleEditor
        combinator="all_of"
        leaves={leaves}
        unsupported={false}
        onChange={vi.fn()}
      />,
    )
    expect(screen.queryByText(/buyer must match/i)).not.toBeInTheDocument()

    rerender(
      <RestrictionRuleEditor
        combinator="all_of"
        leaves={[
          ...leaves,
          {
            kind: "form_answer",
            field_name: "b",
            op: "eq",
            value: "2",
            negate: false,
          },
        ]}
        unsupported={false}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/buyer must match/i)).toBeInTheDocument()
  })

  it("removes a condition row", async () => {
    const onChange = vi.fn()
    const leaves: RestrictionLeafDraft[] = [
      {
        kind: "form_answer",
        field_name: "a",
        op: "eq",
        value: "1",
        negate: false,
      },
    ]
    render(
      <RestrictionRuleEditor
        combinator="all_of"
        leaves={leaves}
        unsupported={false}
        onChange={onChange}
      />,
    )
    await userEvent.click(
      screen.getByRole("button", { name: /remove condition/i }),
    )
    expect(onChange).toHaveBeenCalledWith("all_of", [])
  })

  it("renders a read-only fallback for an unsupported (nested) rule", () => {
    render(
      <RestrictionRuleEditor
        combinator="all_of"
        leaves={[]}
        unsupported={true}
        onChange={vi.fn()}
      />,
    )
    expect(screen.getByText(/doesn't support editing/i)).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: /add condition/i }),
    ).not.toBeInTheDocument()
  })

  it("surfaces a save-time field error", () => {
    render(
      <RestrictionRuleEditor
        combinator="all_of"
        leaves={[]}
        unsupported={false}
        onChange={vi.fn()}
        error="restriction_rule cannot use human_profile_field on a type=direct flow"
      />,
    )
    expect(
      screen.getByText(/cannot use human_profile_field/i),
    ).toBeInTheDocument()
  })
})
