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

const mocks = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }))

vi.mock("@/client", () => ({
  ApplicationsService: {
    getMyApplication: mocks.get,
    updateMyApplication: mocks.update,
  },
}))
vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => ({ id: "popup-1" }) }),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const siblingApplication = {
  id: "sibling-app",
  popup_id: "popup-1",
  sales_flow_id: "sibling-flow",
  info_not_shared: [],
}

function setup(hiddenFields: string[] = []) {
  let serverApplication = {
    id: "primary-app",
    popup_id: "popup-1",
    sales_flow_id: "primary-flow",
    info_not_shared: hiddenFields,
  }
  mocks.get.mockImplementation(async () => structuredClone(serverApplication))
  mocks.update.mockImplementation(async ({ requestBody }) => {
    serverApplication = {
      ...serverApplication,
      info_not_shared: [...requestBody.info_not_shared],
    }
    return structuredClone(serverApplication)
  })
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 } },
  })
  client.setQueryData(queryKeys.applications.mine(), [
    siblingApplication,
    structuredClone(serverApplication),
  ])
  // A legacy popup-scoped lookup can select a different application. It must
  // not be reused by the primary-only settings query.
  client.setQueryData(
    [...queryKeys.applications.mine(), "popup", "popup-1"],
    siblingApplication,
  )
  render(
    <QueryClientProvider client={client}>
      <PrivacySettings />
    </QueryClientProvider>,
  )
  return client
}

async function open() {
  fireEvent.click(
    screen.getByRole("button", { name: "attendees.privacy_button" }),
  )
  await screen.findByRole("checkbox", { name: "attendees.fields.email" })
}

async function save() {
  fireEvent.click(
    screen.getByRole("button", { name: "attendees.privacy_save" }),
  )
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
}

const checkbox = (field: string) =>
  screen.getByRole("checkbox", { name: `attendees.fields.${field}` })

afterEach(cleanup)
beforeEach(() => vi.clearAllMocks())

describe("primary-flow directory sharing settings", () => {
  it("loads only the primary application and updates its explicit flow", async () => {
    setup(["email", "Residence"])
    expect(mocks.get).not.toHaveBeenCalled()
    await open()
    expect(mocks.get).toHaveBeenCalledWith({
      popupId: "popup-1",
      primaryFlowOnly: true,
    })
    expect(checkbox("email").getAttribute("aria-checked")).toBe("false")
    fireEvent.click(checkbox("telegram"))
    await save()
    expect(mocks.update).toHaveBeenCalledWith({
      popupId: "popup-1",
      salesFlowId: "primary-flow",
      requestBody: { info_not_shared: ["email", "Residence", "telegram"] },
    })
  })

  it("does not fall back to a sibling when no primary application exists", async () => {
    setup()
    mocks.get.mockRejectedValue(new Error("Application not found"))
    fireEvent.click(
      screen.getByRole("button", { name: "attendees.privacy_button" }),
    )
    await screen.findByText("attendees.privacy_no_application")
    const saveButton = screen.getByRole("button", {
      name: "attendees.privacy_save",
    })
    expect(saveButton.hasAttribute("disabled")).toBe(true)
    expect(screen.queryByRole("checkbox")).toBeNull()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it("updates both primary caches without modifying the sibling application", async () => {
    const client = setup()
    client.setQueryData(queryKeys.attendees.directory("popup-1"), [])
    await open()
    fireEvent.click(checkbox("email"))
    await save()
    expect(
      client.getQueryData([
        ...queryKeys.applications.mine(),
        "popup",
        "popup-1",
        "primary",
      ]),
    ).toMatchObject({ id: "primary-app", info_not_shared: ["email"] })
    expect(client.getQueryData(queryKeys.applications.mine())).toEqual([
      siblingApplication,
      expect.objectContaining({
        id: "primary-app",
        info_not_shared: ["email"],
      }),
    ])
    expect(
      client.getQueryState(queryKeys.attendees.directory("popup-1"))
        ?.isInvalidated,
    ).toBe(true)
  })

  it("keeps saved primary preferences when reopening within staleTime", async () => {
    setup()
    await open()
    fireEvent.click(checkbox("email"))
    await save()
    await open()
    expect(checkbox("email").getAttribute("aria-checked")).toBe("false")
    fireEvent.click(checkbox("telegram"))
    await save()
    expect(mocks.update.mock.calls[1][0]).toMatchObject({
      salesFlowId: "primary-flow",
      requestBody: { info_not_shared: ["email", "telegram"] },
    })
    expect(mocks.get).toHaveBeenCalledTimes(1)
  })

  it("recognizes and removes all case/whitespace variants from form selections", async () => {
    setup(["Email", " eMaIl ", "Residence"])
    await open()
    expect(checkbox("email").getAttribute("aria-checked")).toBe("false")
    fireEvent.click(checkbox("email"))
    await save()
    expect(mocks.update.mock.calls[0][0].requestBody.info_not_shared).toEqual([
      "Residence",
    ])
  })
})
