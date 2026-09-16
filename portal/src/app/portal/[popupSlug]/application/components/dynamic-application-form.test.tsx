import { render } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import type { PopupPublic } from "@/client"
import type {
  ApplicationFormSchema,
  FormFieldSchema,
} from "@/types/form-schema"
import { DynamicApplicationForm } from "./dynamic-application-form"

vi.mock("framer-motion", async (importOriginal) => ({
  ...(await importOriginal<typeof import("framer-motion")>()),
  useInView: () => true,
}))

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock("@/providers/applicationProvider", () => ({
  useApplication: () => ({ getRelevantApplication: () => null }),
}))

vi.mock("../hooks/use-application-form", () => ({
  useApplicationForm: () => ({
    values: {},
    errors: {},
    handleChange: vi.fn(),
    validate: vi.fn(),
    progress: 0,
  }),
}))

vi.mock("../hooks/use-submit-application", () => ({
  useSubmitApplication: () => ({
    handleSubmit: vi.fn(),
    handleDraft: vi.fn(),
    isDraftPending: false,
    isSubmitPending: false,
    isFeePaymentPending: false,
  }),
}))

vi.mock("@/components/ui/button", () => ({
  ButtonAnimated: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}))

vi.mock("./progress-bar", () => ({ ProgressBar: () => null }))

const schema: ApplicationFormSchema = {
  base_fields: {},
  custom_fields: {},
  sections: [],
}

const popup = {
  id: "popup-1",
  requires_application_fee: false,
  application_layout: "single_page",
} as PopupPublic

describe("DynamicApplicationForm", () => {
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
      section_id: "profile",
      width,
    }
    const { getByText, getByRole } = render(
      <DynamicApplicationForm
        schema={{
          base_fields: { info_not_shared: field },
          custom_fields: {},
          sections: [
            {
              id: "profile",
              label: "Personal Information",
              description:
                "Your basic information helps us identify and contact you.",
              order: 0,
              kind: "standard",
            },
          ],
        }}
        popup={popup}
      />,
    )

    expect(getByText(field.label)).toBeTruthy()
    expect(getByText(field.help_text!)).toBeTruthy()
    expect(getByRole("button", { name: "Email, not selected" })).toBeTruthy()
    expect(getByRole("button", { name: "Telegram, not selected" })).toBeTruthy()
  })

  it("pairs its card background with the semantic card foreground", () => {
    const { container } = render(
      <DynamicApplicationForm
        schema={schema}
        popup={popup}
        salesFlowId="flow-a"
      />,
    )

    const form = container.querySelector("form")
    expect(form?.classList).toContain("bg-card")
    expect(form?.classList).toContain("text-card-foreground")
  })
})
