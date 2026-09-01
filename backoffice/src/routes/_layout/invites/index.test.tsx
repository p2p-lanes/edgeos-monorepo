import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  listInvites: vi.fn(),
}))

vi.mock("@/client", () => ({
  InvitesService: { listInvites: mocks.listInvites },
  PopupsService: { getPopup: vi.fn() },
}))

vi.mock("@tanstack/react-router", async () => {
  const actual = await vi.importActual<object>("@tanstack/react-router")
  return {
    ...actual,
    createFileRoute: () => () => ({ useSearch: () => ({}) }),
    useNavigate: () => vi.fn(),
  }
})

import { getInvitesQueryOptions } from "./index"

describe("invites list query", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listInvites.mockResolvedValue({
      results: [],
      paging: { limit: 20, offset: 0, total: 0 },
    })
  })

  it("requests only admin-created links", async () => {
    await getInvitesQueryOptions("popup-1", 2, 20).queryFn()

    expect(mocks.listInvites).toHaveBeenCalledWith({
      popupId: "popup-1",
      issuer: "admin",
      skip: 40,
      limit: 20,
    })
  })
})
