/**
 * Behavioral test for FlowEmailTemplatesSection (task 14.1). Disclosed as
 * approval-style, written after the component, per the established
 * SalesFlowForm.override.test.tsx precedent for JSX composition.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  EmailTemplatesService: {
    listTemplateTypes: vi.fn(),
    listEmailTemplates: vi.fn(),
  },
  PopupsService: {
    getPopup: vi.fn(),
  },
}))

vi.mock("@/components/EmailTemplateEditor", () => ({
  EmailTemplateEditor: ({ typeInfo }: { typeInfo: { label: string } }) => (
    <div data-testid="email-template-editor">{typeInfo.label}</div>
  ),
}))

import { EmailTemplatesService } from "@/client"
import { FlowEmailTemplatesSection } from "./FlowEmailTemplatesSection"

const mockListTemplateTypes = vi.mocked(EmailTemplatesService.listTemplateTypes)
const mockListEmailTemplates = vi.mocked(
  EmailTemplatesService.listEmailTemplates,
)

const TYPES = [
  {
    type: "application_received",
    label: "Application Received",
    scope: "popup" as const,
    category: "Applications",
    description: "",
    default_subject: "",
    variables: [],
  },
  {
    type: "login_code_user",
    label: "Login Code",
    scope: "tenant" as const,
    category: "Auth",
    description: "",
    default_subject: "",
    variables: [],
  },
]

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe("FlowEmailTemplatesSection", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListTemplateTypes.mockResolvedValue(TYPES as never)
    mockListEmailTemplates.mockResolvedValue({
      results: [],
      paging: { limit: 100, offset: 0, total: 0 },
    } as never)
  })

  it("only lists popup-scope template types (excludes tenant-scope auth emails)", async () => {
    render(
      <Wrapper>
        <FlowEmailTemplatesSection popupId="popup-1" flowId="flow-1" />
      </Wrapper>,
    )

    expect(await screen.findByText("Application Received")).toBeInTheDocument()
    expect(screen.queryByText("Login Code")).not.toBeInTheDocument()
  })

  it("shows 'Flow override' badge only for a row scoped to this flow", async () => {
    mockListEmailTemplates.mockResolvedValue({
      results: [
        {
          id: "t1",
          tenant_id: "tenant-1",
          popup_id: "popup-1",
          sales_flow_id: "flow-1",
          template_type: "application_received",
          scope: "popup",
          html_content: "<p>hi</p>",
          is_active: true,
        },
      ],
      paging: { limit: 100, offset: 0, total: 1 },
    } as never)

    render(
      <Wrapper>
        <FlowEmailTemplatesSection popupId="popup-1" flowId="flow-1" />
      </Wrapper>,
    )

    expect(await screen.findByText("Flow override")).toBeInTheDocument()
  })

  it("shows 'Inherited from event' when the custom row belongs to a different flow", async () => {
    mockListEmailTemplates.mockResolvedValue({
      results: [
        {
          id: "t1",
          tenant_id: "tenant-1",
          popup_id: "popup-1",
          sales_flow_id: "some-other-flow",
          template_type: "application_received",
          scope: "popup",
          html_content: "<p>hi</p>",
          is_active: true,
        },
      ],
      paging: { limit: 100, offset: 0, total: 1 },
    } as never)

    render(
      <Wrapper>
        <FlowEmailTemplatesSection popupId="popup-1" flowId="flow-1" />
      </Wrapper>,
    )

    expect(await screen.findByText("Inherited from event")).toBeInTheDocument()
  })

  it("opens the editor for a template type on Edit click", async () => {
    render(
      <Wrapper>
        <FlowEmailTemplatesSection popupId="popup-1" flowId="flow-1" />
      </Wrapper>,
    )

    await userEvent.click(await screen.findByRole("button", { name: /edit/i }))
    expect(
      await screen.findByTestId("email-template-editor"),
    ).toBeInTheDocument()
  })
})
