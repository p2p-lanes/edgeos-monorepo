import { act, renderHook, waitFor } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { usePromoCode } from "./usePromoCode"

vi.mock("@/client", () => ({
  CouponsService: { validateCoupon: vi.fn() },
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

describe("usePromoCode Sales Flow boundary", () => {
  it("clears an applied code when the selected flow changes", async () => {
    const resetDiscount = vi.fn()
    const setDiscount = vi.fn()
    const restoredRef = { current: false }
    const { result, rerender } = renderHook(
      ({ salesFlowId }: { salesFlowId: string }) =>
        usePromoCode({
          cityId: "popup-1",
          salesFlowId,
          discountAppliedValue: 0,
          setDiscount,
          resetDiscount,
          savedCart: null,
          hasRestoredCheckoutRef: restoredRef,
          validatePromoCodeOverride: async () => 20,
        }),
      { initialProps: { salesFlowId: "flow-main" } },
    )

    await act(async () => {
      expect(await result.current.applyPromoCode("STAY20")).toBe(true)
    })
    expect(result.current.promoCode).toBe("STAY20")

    rerender({ salesFlowId: "flow-partner" })

    await waitFor(() => {
      expect(result.current.promoCode).toBe("")
      expect(result.current.promoCodeValid).toBe(false)
      expect(result.current.promoCodeDiscount).toBe(0)
    })
    expect(resetDiscount).toHaveBeenCalledOnce()
  })

  it("ignores validation that settles after the flow changes", async () => {
    let resolveValidation!: (discount: number) => void
    const validation = new Promise<number>((resolve) => {
      resolveValidation = resolve
    })
    const setDiscount = vi.fn()
    const { result, rerender } = renderHook(
      ({ salesFlowId }: { salesFlowId: string }) =>
        usePromoCode({
          cityId: "popup-1",
          salesFlowId,
          discountAppliedValue: 0,
          setDiscount,
          resetDiscount: vi.fn(),
          savedCart: null,
          hasRestoredCheckoutRef: { current: false },
          validatePromoCodeOverride: () => validation,
        }),
      { initialProps: { salesFlowId: "flow-main" } },
    )

    let applyResult!: Promise<boolean>
    act(() => {
      applyResult = result.current.applyPromoCode("LATE20")
    })
    await waitFor(() => expect(result.current.promoIsLoading).toBe(true))

    rerender({ salesFlowId: "flow-partner" })
    await act(async () => {
      resolveValidation(20)
      await applyResult
    })

    expect(await applyResult).toBe(false)
    expect(result.current.promoCode).toBe("")
    expect(result.current.promoCodeValid).toBe(false)
    expect(setDiscount).not.toHaveBeenCalled()
  })
})
