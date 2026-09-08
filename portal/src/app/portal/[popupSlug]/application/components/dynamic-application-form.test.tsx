import { render } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import type { PopupPublic } from "@/client"
import type { ApplicationFormSchema } from "@/types/form-schema"
import { DynamicApplicationForm } from "./dynamic-application-form"

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
