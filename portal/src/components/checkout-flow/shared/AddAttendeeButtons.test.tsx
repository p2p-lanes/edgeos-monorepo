import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CHECKOUT_MODE } from "@/checkout/popupCheckoutPolicy"
import { buildPersistedPassSelections } from "@/hooks/checkout/useCartPersistence"
import { buildItemsSnapshot } from "@/hooks/checkout/useOpenCartPersistence"
import type { CheckoutRecipientDraft } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"
import AddAttendeeButtons from "./AddAttendeeButtons"

const mocks = vi.hoisted(() => ({
  addAttendee: vi.fn(),
  addRecipientDraft: vi.fn(),
  attendeePasses: [] as Array<{ id: string; category_id: string }>,
  email: " sam@example.com ",
}))

vi.mock("@/app/portal/[popupSlug]/passes/components/AttendeeModal", () => ({
  AttendeeModal: ({
    onSubmit,
  }: {
    onSubmit: (data: unknown) => Promise<void>
  }) => (
    <button
      type="button"
      onClick={() =>
        void onSubmit({
          name: "Sam Companion",
          email: mocks.email,
          gender: "nonbinary",
          category_id: "spouse",
          additional_data: { residence: "Lisbon" },
        })
      }
    >
      Submit companion
    </button>
  ),
}))

vi.mock("@/hooks/useAttendee", () => ({
  default: () => ({ addAttendee: mocks.addAttendee, loading: false }),
}))

vi.mock("@/hooks/useAttendeeCategories", () => ({
  useAttendeeCategories: () => ({
    categories: [
      { id: "main", key: "main", is_primary: true },
      {
        id: "spouse",
        key: "spouse",
        is_primary: false,
        max_per_application: 2,
      },
      { id: "kid", key: "kid", is_primary: false },
    ],
  }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({ getCity: () => ({ id: "popup-1" }) }),
}))

vi.mock("@/providers/passesProvider", () => ({
  usePassesProvider: () => ({
    attendeePasses: mocks.attendeePasses,
    addRecipientDraft: mocks.addRecipientDraft,
  }),
}))

describe("AddAttendeeButtons", () => {
  beforeEach(() => {
    mocks.addAttendee.mockReset()
    mocks.addRecipientDraft.mockReset()
    mocks.addRecipientDraft.mockReturnValue(
      "recipient:draft:11111111-1111-4111-8111-111111111111",
    )
    mocks.attendeePasses = []
    mocks.email = " sam@example.com "
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "11111111-1111-4111-8111-111111111111",
    )
  })

  it("hides companion actions outside the current step categories", () => {
    render(<AddAttendeeButtons allowedCategoryIds={["main"]} />)

    expect(screen.queryByRole("button", { name: "Add Spouse" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Add Kid" })).toBeNull()
  })

  it("shows only companions supported by the current step", () => {
    render(<AddAttendeeButtons allowedCategoryIds={["spouse"]} />)

    expect(screen.getByRole("button", { name: "Add Spouse" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Add Kid" })).toBeNull()
  })

  it("submits one stable local recipient draft without an attendee mutation", async () => {
    const provider = await vi.importActual<
      typeof import("@/providers/passesProvider")
    >("@/providers/passesProvider")
    const onAttendeeAdded = vi.fn()
    render(
      <AddAttendeeButtons
        allowedCategoryIds={["spouse"]}
        onAttendeeAdded={onAttendeeAdded}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Add Spouse" }))
    fireEvent.click(screen.getByRole("button", { name: "Submit companion" }))

    await waitFor(() => expect(mocks.addRecipientDraft).toHaveBeenCalledOnce())
    expect(mocks.addRecipientDraft).toHaveBeenCalledWith({
      recipient_key: "draft:11111111-1111-4111-8111-111111111111",
      name: "Sam Companion",
      email: "sam@example.com",
      category_id: "spouse",
      profile_snapshot: {
        residence: "Lisbon",
        category: "spouse",
        gender: "nonbinary",
      },
    })
    expect(onAttendeeAdded).toHaveBeenCalledWith(
      "recipient:draft:11111111-1111-4111-8111-111111111111",
    )
    expect(globalThis.crypto.randomUUID).toHaveBeenCalledOnce()
    expect(mocks.addAttendee).not.toHaveBeenCalled()

    const recipient = mocks.addRecipientDraft.mock
      .calls[0][0] as CheckoutRecipientDraft
    const product = {
      id: "spouse-pass",
      name: "Spouse pass",
      category: "ticket",
      price: 100,
      is_active: true,
    } as ProductsPass
    const projected = provider.applyCartSelections(
      provider.projectRecipientDraft(
        [],
        recipient,
        "popup-1",
        [product],
        0,
        new Map(),
        CHECKOUT_MODE.PASS_SYSTEM,
      ),
      [{ recipient_key: recipient.recipient_key, product_id: product.id }],
    )[0]
    const selectedPass = {
      attendeeId: projected.id,
      attendee: projected,
      recipient: projected.recipient,
      productId: product.id,
      product,
      quantity: 1,
      price: 100,
    }
    const authenticated = buildPersistedPassSelections([selectedPass])
    const open = buildItemsSnapshot({
      selectedPasses: [selectedPass],
      housing: null,
      merch: [],
      patron: null,
      selectedMealPlans: [],
      accommodations: [],
      dynamicItems: {},
      promoCode: "",
      promoCodeValid: false,
      insurance: false,
      currentStep: "passes",
    })
    const restored = provider.rebuildRecipientPasses(
      [],
      open.recipients,
      open.passes,
      "popup-1",
      [product],
      0,
      new Map(),
      CHECKOUT_MODE.PASS_SYSTEM,
    )

    expect(authenticated).toEqual({
      passes: open.passes,
      recipients: [recipient],
    })
    expect(restored).toHaveLength(1)
    expect(restored[0].recipient).toEqual(recipient)
    expect(restored[0].products[0]).toMatchObject({
      id: product.id,
      selected: true,
    })
  })

  it("counts persisted and local companion drafts against the category cap", () => {
    mocks.attendeePasses = [
      { id: "persisted-spouse", category_id: "spouse" },
      { id: "recipient:draft:one", category_id: "spouse" },
    ]

    render(<AddAttendeeButtons allowedCategoryIds={["spouse"]} />)

    expect(screen.queryByRole("button", { name: "Add Spouse" })).toBeNull()
  })

  it("omits a blank optional companion email", async () => {
    mocks.email = "   "
    render(<AddAttendeeButtons allowedCategoryIds={["spouse"]} />)

    fireEvent.click(screen.getByRole("button", { name: "Add Spouse" }))
    fireEvent.click(screen.getByRole("button", { name: "Submit companion" }))

    await waitFor(() => expect(mocks.addRecipientDraft).toHaveBeenCalledOnce())
    expect(mocks.addRecipientDraft.mock.calls[0][0]).not.toHaveProperty("email")
  })
})
