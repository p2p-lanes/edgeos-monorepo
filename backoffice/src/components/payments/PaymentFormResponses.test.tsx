import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { PaymentFormResponses } from "./PaymentFormResponses"

describe("PaymentFormResponses", () => {
  it("shows saved sections in order and retains historical question labels", () => {
    render(
      <PaymentFormResponses
        snapshot={{
          buyer_email: "private@example.com",
          attribution: { campaign: "internal-campaign" },
          sections: [
            {
              section_label: "Preferences at purchase",
              section_order: 2,
              fields: [
                {
                  field_name: "renamed_question",
                  field_label: "Original question label",
                  value: "Saved response",
                },
              ],
            },
            {
              section_label: "Contact",
              section_order: 0,
              fields: [{ field_label: "Phone", value: "+1 555 1234" }],
            },
          ],
        }}
      />,
    )

    const responses = screen.getByRole("region", { name: "Form responses" })
    expect(
      within(responses)
        .getAllByRole("heading", { level: 4 })
        .map((h) => h.textContent),
    ).toEqual(["Contact", "Preferences at purchase"])
    expect(screen.getByText("Original question label")).toBeInTheDocument()
    expect(screen.getByText("Saved response")).toBeInTheDocument()
    expect(screen.queryByText("renamed_question")).not.toBeInTheDocument()
    expect(screen.queryByText("private@example.com")).not.toBeInTheDocument()
    expect(screen.queryByText("internal-campaign")).not.toBeInTheDocument()
  })

  it("preserves false and zero, formats multiple choices, and escapes submitted text", () => {
    const fields = [
      { field_label: "Opted in", value: true },
      { field_label: "Opted out", value: false },
      { field_label: "Count", value: 0 },
      { field_label: "Choices", value: ["First", "Second"] },
      { field_label: "Extra details", value: { answer: "Nested" } },
      { field_name: "missing_label", value: "Fallback" },
      { field_label: "Optional answer", value: null },
      { field_label: "Empty choices", value: [] },
      { field_label: "Comments", value: '<img src=x onerror="alert(1)">' },
    ]
    const { container } = render(
      <PaymentFormResponses snapshot={{ sections: [{ fields }] }} />,
    )
    for (const value of [
      "Yes",
      "No",
      "0",
      "First, Second",
      "Fallback",
      "missing_label",
    ]) {
      expect(screen.getByText(value)).toBeInTheDocument()
    }
    expect(screen.getByText(/"answer": "Nested"/)).toBeInTheDocument()
    expect(screen.getAllByText("Not answered")).toHaveLength(2)
    expect(screen.getByText("Form details")).toBeInTheDocument()
    expect(screen.getByText(fields[8].value as string)).toBeInTheDocument()
    expect(container.querySelector("img")).toBeNull()
  })

  it.each([
    null,
    {},
    { sections: null },
    { sections: "invalid" },
    { sections: [null, {}, { fields: [null, {}, "invalid"] }] },
    { sections: [{ section_label: "Empty section", fields: [] }] },
  ])("omits the panel for legacy or malformed snapshots: %j", (snapshot) => {
    const { container } = render(<PaymentFormResponses snapshot={snapshot} />)
    expect(container).toBeEmptyDOMElement()
  })
})
