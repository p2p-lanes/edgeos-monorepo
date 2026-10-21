/**
 * The comment composer's keyboard shortcut: Cmd/Ctrl+Enter sends, plain Enter
 * is a newline, and an empty body or an in-flight send never fires a request.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/client", () => ({
  ApplicationsService: {
    listApplicationComments: vi.fn(),
    createApplicationComment: vi.fn(),
    updateApplicationComment: vi.fn(),
    deleteApplicationComment: vi.fn(),
  },
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}))

vi.mock("@/hooks/useAuth", () => ({
  default: () => ({ user: { id: "user-1" }, isSuperadmin: false }),
}))

import { ApplicationsService } from "@/client"
import { ApplicationCommentThread } from "./ApplicationCommentThread"

const mockList = vi.mocked(ApplicationsService.listApplicationComments)
const mockCreate = vi.mocked(ApplicationsService.createApplicationComment)

function renderThread() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <ApplicationCommentThread applicationId="app-1" />
    </QueryClientProvider>,
  )
}

describe("ApplicationCommentThread submit shortcut", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockList.mockResolvedValue({
      results: [],
      paging: { offset: 0, limit: 0, total: 0 },
    } as never)
  })

  it("sends on Ctrl+Enter", async () => {
    mockCreate.mockResolvedValue({} as never)
    renderThread()
    const user = userEvent.setup()

    await user.type(
      screen.getByPlaceholderText("Write a comment…"),
      "Looks good",
    )
    await user.keyboard("{Control>}{Enter}{/Control}")

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    expect(mockCreate).toHaveBeenCalledWith({
      applicationId: "app-1",
      requestBody: { body: "Looks good" },
    })
  })

  it("sends on Cmd+Enter", async () => {
    mockCreate.mockResolvedValue({} as never)
    renderThread()
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText("Write a comment…"), "Ship it")
    await user.keyboard("{Meta>}{Enter}{/Meta}")

    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
  })

  it("inserts a newline on plain Enter instead of sending", async () => {
    renderThread()
    const user = userEvent.setup()
    const textarea = screen.getByPlaceholderText("Write a comment…")

    await user.type(textarea, "line one{Enter}line two")

    expect(textarea).toHaveValue("line one\nline two")
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("does nothing when the comment is blank", async () => {
    renderThread()
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText("Write a comment…"), "   ")
    await user.keyboard("{Control>}{Enter}{/Control}")

    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("does not send twice while a send is pending", async () => {
    mockCreate.mockReturnValue(new Promise(() => {}) as never)
    renderThread()
    const user = userEvent.setup()

    await user.type(screen.getByPlaceholderText("Write a comment…"), "Once")
    await user.keyboard("{Control>}{Enter}{/Control}")
    await waitFor(() => expect(mockCreate).toHaveBeenCalledTimes(1))
    await user.keyboard("{Control>}{Enter}{/Control}")

    expect(mockCreate).toHaveBeenCalledTimes(1)
  })

  it("shows the shortcut hint next to the button", async () => {
    renderThread()
    expect(await screen.findByText(/\+Enter to send/)).toBeInTheDocument()
  })
})
