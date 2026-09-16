import { type FormFieldSchema, SchemaField } from "@edgeos/shared-form-ui"
import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const richTextCheckbox = (required: boolean): FormFieldSchema => ({
  type: "rich_text",
  label: "Consent",
  required,
  config: {
    content: "I agree to the [terms](https://example.com/terms)",
    is_checkbox: true,
  },
})

describe("SchemaField required indicator", () => {
  it("renders the required indicator for a required rich-text checkbox", () => {
    render(
      <SchemaField
        name="consent"
        field={richTextCheckbox(true)}
        value={false}
        onChange={vi.fn()}
      />,
    )

    expect(screen.getByRole("checkbox")).not.toBeNull()
    expect(
      screen.getByRole("link", { name: "terms" }).getAttribute("href"),
    ).toBe("https://example.com/terms")
    expect(screen.getByText("*")).not.toBeNull()
  })

  it("does not render the indicator for an optional rich-text checkbox", () => {
    render(
      <SchemaField
        name="consent"
        field={richTextCheckbox(false)}
        value={false}
        onChange={vi.fn()}
      />,
    )

    expect(screen.queryByText("*")).toBeNull()
  })
})
