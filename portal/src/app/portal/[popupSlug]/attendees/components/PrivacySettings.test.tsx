import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { queryKeys } from "@/lib/query-keys"
import PrivacySettings from "./PrivacySettings"

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  getValues: vi.fn(),
  updateValues: vi.fn(),
}))

vi.mock("@/client", () => ({
  HumansService: {
    getMyDirectorySettings: mocks.get,
    updateMyDirectorySettings: mocks.update,
  },
  ApplicationsService: {
    getMyDirectoryValues: mocks.getValues,
    updateMyDirectoryValues: mocks.updateValues,
  },
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => ({ id: "popup-1" }) }),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const initialSettings = {
  popup_id: "popup-1",
  listed: false,
  shared_fields: [],
  available_fields: [
    { id: "first_name", label: "Given name" },
    { id: "last_name", label: "Family name" },
    { id: "role_custom", label: "Position" },
  ],
}

function setup() {
  mocks.get.mockResolvedValue(structuredClone(initialSettings))
  mocks.getValues.mockResolvedValue({})
  mocks.updateValues.mockResolvedValue({})
  mocks.update.mockImplementation(async ({ requestBody }) => ({
    ...structuredClone(initialSettings),
    ...requestBody,
  }))
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  })
  client.setQueryData(queryKeys.attendees.directory("popup-1"), [])
  render(
    <QueryClientProvider client={client}>
      <PrivacySettings />
    </QueryClientProvider>,
  )
  return client
}

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

describe("popup-scoped directory privacy settings", () => {
  it("lets a human opt into the directory and share configured fields", async () => {
    const client = setup()
    fireEvent.click(
      await screen.findByRole("button", { name: "attendees.privacy_button" }),
    )
    const listed = await screen.findByRole("checkbox", {
      name: "attendees.directory_listed",
    })
    expect(listed.getAttribute("aria-checked")).toBe("false")

    fireEvent.click(listed)
    fireEvent.click(document.getElementById("share-first_name")!)
    fireEvent.click(
      screen.getByRole("button", { name: "attendees.privacy_save" }),
    )

    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        popupId: "popup-1",
        requestBody: { listed: true, shared_fields: ["first_name"] },
      }),
    )
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(
      client.getQueryState(queryKeys.attendees.directory("popup-1"))
        ?.isInvalidated,
    ).toBe(true)
  })

  it("uses the popup's configured fields and starts them unshared", async () => {
    setup()
    fireEvent.click(
      await screen.findByRole("button", { name: "attendees.privacy_button" }),
    )
    await screen.findByRole("dialog")
    expect(
      document
        .getElementById("share-role_custom")
        ?.getAttribute("aria-checked"),
    ).toBe("false")
    expect(mocks.get).toHaveBeenCalledWith({ popupId: "popup-1" })
  })
})
