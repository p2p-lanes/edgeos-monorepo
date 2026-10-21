import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import type { FormFieldSchema } from "@/types/form-schema"
import { FormSection } from "./form-section"

vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useInView: () => true,
}))

describe("FormSection", () => {
  it.each([
    "full",
    "half",
    "half_row",
  ] as const)("shows a multiselect label and help text at %s width", (width) => {
    const field: FormFieldSchema = {
      type: "multiselect",
      label: "Food preferences",
      help_text: "Select the options that apply to you.",
      required: false,
      options: ["Vegetarian", "Vegan"],
      width,
    }
    const { getByText, getByRole } = render(
      <FormSection
        title="Personal Information"
        fields={[["food_preferences", field]]}
        values={{}}
        errors={{}}
        onChange={vi.fn()}
      />,
    )

    expect(getByText(field.label)).toBeTruthy()
    expect(getByText(field.help_text!)).toBeTruthy()
    expect(
      getByRole("button", { name: "Vegetarian, not selected" }),
    ).toBeTruthy()
    expect(getByRole("button", { name: "Vegan, not selected" })).toBeTruthy()
  })
})
