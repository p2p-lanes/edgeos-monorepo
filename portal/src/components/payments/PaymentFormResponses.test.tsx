import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { PaymentsService } from "@/client"
import { PaymentFormResponses } from "./PaymentFormResponses"

vi.mock("@/client", () => ({
  PaymentsService: {
    getMyFormResponses: vi.fn(),
    editMyFormResponses: vi.fn(),
  },
}))
vi.mock("@/app/portal/[popupSlug]/events/lib/useFileUpload", () => ({
  useFileUpload: () => ({ uploadFile: vi.fn() }),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
// Native select keeps this test focused on loading, payloads, and error handling.
vi.mock("@edgeos/shared-form-ui", () => ({
  FileUploadProvider: ({ children }: { children: React.ReactNode }) => children,
  SchemaField: ({
    name,
    value,
    onChange,
    error,
  }: {
    name: string
    value: string
    onChange: (name: string, value: string) => void
    error?: string
  }) => (
    <>
      <label>
        Location
        <select
          value={value ?? ""}
          onChange={(e) => onChange(name, e.target.value)}
        >
          <option value="">Choose</option>
          <option>Riva Resort</option>
          <option>Circle Coworking</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
    </>
  ),
}))
const original = {
  version: 0,
  title: "Delivery details",
  can_edit: true,
  editing_enabled: true,
  deadline: "2099-10-20T12:00:00Z",
  timezone: "Asia/Kolkata",
  fields: [
    {
      id: "field-1",
      value: "Riva Resort",
      editable: true,
      definition: {
        type: "select",
        label: "Delivery location",
        required: true,
        options: ["Riva Resort", "Circle Coworking"],
      },
    },
  ],
  history: [],
}
function mount(inDialog = false, collapsible = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  return render(
    <QueryClientProvider client={client}>
      {inDialog ? (
        <div role="dialog" aria-label="Purchase details">
          <PaymentFormResponses
            paymentId="payment-1"
            collapsible={collapsible}
          />
        </div>
      ) : (
        <PaymentFormResponses paymentId="payment-1" collapsible={collapsible} />
      )}
    </QueryClientProvider>,
  )
}
afterEach(cleanup)
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(PaymentsService.getMyFormResponses).mockResolvedValue(original)
})

describe("post-purchase responses", () => {
  it("collapses answers until requested and allows hiding them again", async () => {
    mount(false, true)
    const toggle = await screen.findByRole("button", {
      name: "form_responses.view",
    })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(screen.queryByText("Riva Resort")).toBeNull()
    fireEvent.click(toggle)
    expect(screen.getByText("Riva Resort")).toBeTruthy()
    expect(
      screen.getByRole("button", { name: "form_responses.edit" }),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "form_responses.hide" }))
    expect(screen.queryByText("Riva Resort")).toBeNull()
  })

  it("does not offer expansion when there are no answers", async () => {
    vi.mocked(PaymentsService.getMyFormResponses).mockResolvedValue({
      ...original,
      fields: [],
    })
    mount(false, true)
    await waitFor(() =>
      expect(PaymentsService.getMyFormResponses).toHaveBeenCalled(),
    )
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("loads saved answers, opens the editor and sends only values plus version", async () => {
    vi.mocked(PaymentsService.editMyFormResponses).mockResolvedValue({
      ...original,
      version: 1,
      fields: [{ ...original.fields[0], value: "Circle Coworking" }],
    })
    mount(true)
    fireEvent.click(
      await screen.findByRole("button", { name: "form_responses.edit" }),
    )
    await screen.findByRole("form", { name: "form_responses.edit" })
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    fireEvent.change(await screen.findByRole("combobox"), {
      target: { value: "Circle Coworking" },
    })
    fireEvent.click(screen.getByRole("button", { name: "form_responses.save" }))
    await waitFor(() =>
      expect(PaymentsService.editMyFormResponses).toHaveBeenCalledWith({
        paymentId: "payment-1",
        requestBody: { version: 0, answers: { "field-1": "Circle Coworking" } },
      }),
    )
    await waitFor(() => expect(screen.queryByRole("form")).toBeNull())
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    expect(await screen.findByText("Circle Coworking")).toBeTruthy()
  })
  it("cancels inline editing and returns to saved answers in the same popup", async () => {
    mount(true)
    fireEvent.click(
      await screen.findByRole("button", { name: "form_responses.edit" }),
    )
    fireEvent.change(await screen.findByRole("combobox"), {
      target: { value: "Circle Coworking" },
    })
    fireEvent.click(
      screen.getByRole("button", { name: "form_responses.cancel" }),
    )
    expect(screen.queryByRole("form")).toBeNull()
    expect(screen.getByText("Riva Resort")).toBeTruthy()
    expect(screen.getAllByRole("dialog")).toHaveLength(1)
    expect(PaymentsService.editMyFormResponses).not.toHaveBeenCalled()
  })

  it("blocks empty required fields before calling the API", async () => {
    mount()
    fireEvent.click(
      await screen.findByRole("button", { name: "form_responses.edit" }),
    )
    fireEvent.change(await screen.findByRole("combobox"), {
      target: { value: "" },
    })
    fireEvent.click(screen.getByRole("button", { name: "form_responses.save" }))
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(PaymentsService.editMyFormResponses).not.toHaveBeenCalled()
  })
  it.each([
    { can_edit: false, editing_enabled: false },
    { can_edit: false, deadline: "2020-01-01T00:00:00Z" },
  ])("keeps answers read-only when editing is unavailable", async (policy) => {
    vi.mocked(PaymentsService.getMyFormResponses).mockResolvedValue({
      ...original,
      ...policy,
    })
    mount()
    expect(await screen.findByText("Riva Resort")).toBeTruthy()
    expect(
      screen.queryByRole("button", { name: "form_responses.edit" }),
    ).toBeNull()
  })
  it("keeps server errors visible and refreshes policy when a deadline changes mid-edit", async () => {
    const { toast } = await import("sonner")
    vi.mocked(PaymentsService.editMyFormResponses).mockRejectedValue({
      body: { detail: "The editing deadline has passed" },
    })
    mount()
    fireEvent.click(
      await screen.findByRole("button", { name: "form_responses.edit" }),
    )
    await screen.findByRole("combobox")
    vi.mocked(PaymentsService.getMyFormResponses).mockResolvedValue({
      ...original,
      can_edit: false,
    })
    fireEvent.click(screen.getByRole("button", { name: "form_responses.save" }))
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "The editing deadline has passed",
      ),
    )
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(
      screen
        .getByRole("button", { name: "form_responses.save" })
        .hasAttribute("disabled"),
    ).toBe(true)
  })
})

it("shows an unanswered historical question and lets the buyer complete it", async () => {
  vi.mocked(PaymentsService.getMyFormResponses).mockResolvedValue({
    ...original,
    fields: [{ ...original.fields[0], value: null }],
  })
  vi.mocked(PaymentsService.editMyFormResponses).mockResolvedValue({
    ...original,
    version: 1,
    fields: [{ ...original.fields[0], value: "Circle Coworking" }],
  })
  mount()
  expect(await screen.findByText("form_responses.not_answered")).toBeTruthy()
  fireEvent.click(screen.getByRole("button", { name: "form_responses.edit" }))
  const select = await screen.findByRole("combobox")
  expect((select as HTMLSelectElement).value).toBe("")
  fireEvent.change(select, { target: { value: "Circle Coworking" } })
  fireEvent.click(screen.getByRole("button", { name: "form_responses.save" }))
  await waitFor(() =>
    expect(PaymentsService.editMyFormResponses).toHaveBeenCalledWith({
      paymentId: "payment-1",
      requestBody: { version: 0, answers: { "field-1": "Circle Coworking" } },
    }),
  )
  expect(await screen.findByText("Circle Coworking")).toBeTruthy()
})
