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
  ] as const)("shows the privacy field label and help text at %s width", (width) => {
    const field: FormFieldSchema = {
      type: "multiselect",
      label: "Info I'm NOT willing to share with other attendees",
      help_text:
        "We will make a directory to make it easier for attendees to coordinate",
      required: false,
      options: ["Email", "Telegram"],
      width,
    }
    const { getByText, getByRole } = render(
      <FormSection
        title="Personal Information"
        fields={[["info_not_shared", field]]}
        values={{}}
        errors={{}}
        onChange={vi.fn()}
      />,
    )

    expect(getByText(field.label)).toBeTruthy()
    expect(getByText(field.help_text!)).toBeTruthy()
    expect(getByRole("button", { name: "Email, not selected" })).toBeTruthy()
    expect(getByRole("button", { name: "Telegram, not selected" })).toBeTruthy()
  })
})
