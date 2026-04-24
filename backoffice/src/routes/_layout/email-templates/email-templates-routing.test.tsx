import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  EmailTemplatesService: {
    listTemplateTypes: vi.fn(),
    listEmailTemplates: vi.fn(),
  },
}))

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router")
  return {
    ...actual,
    createFileRoute: () => () => ({
      useParams: () => ({ type: "login_code_human" }),
    }),
    Link: ({ children, to, params, ...props }: any) => (
      <a href={typeof to === "string" ? to : "#"} {...props}>
        {children}
        {params?.type ? `:${params.type}` : null}
      </a>
    ),
    useNavigate: () => vi.fn(),
  }
})

vi.mock("@/contexts/WorkspaceContext", () => ({
  useWorkspace: vi.fn(),
}))

vi.mock("@/hooks/useAuth", () => ({
  default: () => ({ isAdmin: true, isUserLoading: false }),
}))

vi.mock("@/components/Common/QueryErrorBoundary", () => ({
  QueryErrorBoundary: ({ children }: { children: ReactNode }) => children,
}))

vi.mock("@/components/Common/WorkspaceAlert", () => ({
  WorkspaceAlert: ({ resource }: { resource: string }) => (
    <div>{`workspace-alert:${resource}`}</div>
  ),
}))

vi.mock("@/components/EmailTemplateEditor", () => ({
  EmailTemplateEditor: ({
    popupId,
    templateType,
  }: {
    popupId?: string
    templateType: string
  }) => <div>{`editor:${templateType}:${popupId ?? "tenant"}`}</div>,
}))

import { EmailTemplatesService } from "@/client"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import { EditorContent } from "./$type.edit"
import { TemplateList } from "./index"

const mockUseWorkspace = vi.mocked(useWorkspace)
const mockListTemplateTypes = vi.mocked(EmailTemplatesService.listTemplateTypes)
const mockListEmailTemplates = vi.mocked(
  EmailTemplatesService.listEmailTemplates,
)

function renderWithQueryClient(ui: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  })

  return render(
    <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>,
  )
}

describe("email template routing behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUseWorkspace.mockReturnValue({
      selectedPopupId: null,
      selectedTenantId: "tenant-1",
      effectiveTenantId: "tenant-1",
      isContextReady: false,
      needsTenantSelection: false,
      needsPopupSelection: true,
      setSelectedPopupId: vi.fn(),
      setSelectedTenantId: vi.fn(),
    })

    mockListTemplateTypes.mockResolvedValue([
      {
        type: "login_code_human",
        label: "Portal Login Code",
        description: "Tenant auth",
        category: "Auth",
        scope: "tenant",
        default_subject: "Portal login",
        variables: [],
      },
      {
        type: "application_received",
        label: "Application Received",
        description: "Popup communication",
        category: "Application",
        scope: "popup",
        default_subject: "Application received",
        variables: [],
      },
    ] as Awaited<ReturnType<typeof EmailTemplatesService.listTemplateTypes>>)

    mockListEmailTemplates.mockImplementation(async ({ popupId } = {}) => ({
      results: popupId
        ? []
        : [
            {
              id: "template-1",
              tenant_id: "tenant-1",
              popup_id: null,
              template_type: "login_code_human",
              subject: "Tenant subject",
              html_content: "<html></html>",
              is_active: true,
            },
          ],
      paging: { offset: 0, limit: 100, total: popupId ? 0 : 1 },
    }))
  })

  it("shows auth templates without popup selection and gates popup templates", async () => {
    renderWithQueryClient(<TemplateList />)

    expect(await screen.findByText("Portal Login Code")).toBeInTheDocument()
    expect(screen.getByText("Application Received")).toBeInTheDocument()
    expect(screen.getByText("Custom")).toBeInTheDocument()
    expect(screen.getByText("Select popup to edit")).toBeInTheDocument()

    await waitFor(() => {
      expect(mockListEmailTemplates).toHaveBeenCalledWith()
    })
  })

  it("opens auth template editor with tenant context only", async () => {
    renderWithQueryClient(<EditorContent templateType="login_code_human" />)

    expect(
      await screen.findByText("editor:login_code_human:tenant"),
    ).toBeInTheDocument()
  })
})
