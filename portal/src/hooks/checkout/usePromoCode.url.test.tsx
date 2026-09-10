import { act, renderHook, waitFor } from "@testing-library/react"
import { type ReactNode, StrictMode } from "react"
import { describe, expect, it, vi } from "vitest"
import { usePromoCode } from "./usePromoCode"

vi.mock("@/client", () => ({
  CouponsService: { validateCoupon: vi.fn() },
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function setup(initialPromoCode: string | null = " friends20 ") {
  const validate = vi
    .fn<(code: string) => Promise<number>>()
    .mockResolvedValue(20)
  const setDiscount = vi.fn()
  const resetDiscount = vi.fn()
  const restoredRef = { current: false }
  const hook = renderHook(
    ({ salesFlowId, releaseSettled }) =>
      usePromoCode({
        cityId: "popup-1",
        salesFlowId,
        initialPromoCode,
        discountAppliedValue: 0,
        setDiscount,
        resetDiscount,
        savedCart: null,
        hasRestoredCheckoutRef: restoredRef,
        validatePromoCodeOverride: validate,
        releaseSettled,
      }),
    {
      initialProps: { salesFlowId: "flow-friends", releaseSettled: false },
      wrapper: ({ children }: { children: ReactNode }) => (
        <StrictMode>{children}</StrictMode>
      ),
    },
  )
  const ready = () => {
    restoredRef.current = true
    hook.rerender({ salesFlowId: "flow-friends", releaseSettled: true })
  }
  return { ...hook, validate, setDiscount, resetDiscount, restoredRef, ready }
}

describe("usePromoCode entry-link coupon", () => {
  it("waits for cart restoration and pending release, then validates once", async () => {
    const { result, rerender, validate, setDiscount, restoredRef } = setup()
    expect(validate).not.toHaveBeenCalled()

    rerender({ salesFlowId: "flow-friends", releaseSettled: true })
    expect(validate).not.toHaveBeenCalled()

    restoredRef.current = true
    rerender({ salesFlowId: "flow-friends", releaseSettled: false })
    expect(validate).not.toHaveBeenCalled()

    rerender({ salesFlowId: "flow-friends", releaseSettled: true })
    await waitFor(() => expect(result.current.promoCodeValid).toBe(true))
    expect(validate).toHaveBeenCalledExactlyOnceWith("FRIENDS20")
    expect(result.current.promoCode).toBe("FRIENDS20")
    expect(result.current.promoCodeDiscount).toBe(20)
    expect(setDiscount).toHaveBeenCalledWith({
      discount_code: "FRIENDS20",
      discount_type: "percentage",
      discount_value: 20,
      city_id: "popup-1",
    })

    rerender({ salesFlowId: "flow-friends", releaseSettled: true })
    expect(validate).toHaveBeenCalledTimes(1)
  })

  it("uses the URL coupon instead of the restored cart's coupon", async () => {
    const { result, validate, ready } = setup()
    act(() => result.current.setPromoCode("SAVED10"))
    ready()
    await waitFor(() => expect(result.current.promoCodeValid).toBe(true))
    expect(validate).toHaveBeenCalledExactlyOnceWith("FRIENDS20")
    expect(result.current.promoCode).toBe("FRIENDS20")
  })

  it.each([
    null,
    "",
    "   ",
  ])("preserves cart revalidation without a URL code (%s)", async (code) => {
    const { result, validate, ready } = setup(code)
    act(() => result.current.setPromoCode("SAVED10"))
    ready()
    await waitFor(() => expect(result.current.promoCodeValid).toBe(true))
    expect(validate).toHaveBeenCalledExactlyOnceWith("SAVED10")
  })

  it.each([
    null,
    "",
    "   ",
  ])("does nothing without a URL or saved code (%s)", (code) => {
    const { validate, ready } = setup(code)
    ready()
    expect(validate).not.toHaveBeenCalled()
  })

  it.each([
    "invalid",
    "network",
  ])("does not apply a rejected code (%s), and allows manual recovery", async (failure) => {
    const { result, validate, setDiscount, ready, rerender } = setup()
    if (failure === "invalid") validate.mockResolvedValueOnce(0)
    else validate.mockRejectedValueOnce(new Error("Validation failed"))
    act(() => result.current.setPromoCode("SAVED10"))
    ready()
    await waitFor(() =>
      expect(result.current.promoError).toBe(
        "checkout.errors.confirm_coupon_invalid",
      ),
    )
    expect(result.current.promoCode).toBe("")
    expect(result.current.promoCodeValid).toBe(false)
    expect(result.current.promoCodeDiscount).toBe(0)
    expect(result.current.promoIsLoading).toBe(false)
    expect(setDiscount).not.toHaveBeenCalled()
    rerender({ salesFlowId: "flow-friends", releaseSettled: true })
    expect(validate).toHaveBeenCalledTimes(1)

    await act(async () => {
      expect(await result.current.applyPromoCode("OTHER20")).toBe(true)
    })
    expect(result.current.promoCode).toBe("OTHER20")
    expect(result.current.promoError).toBeNull()
  })

  it("does not reapply the link coupon after the buyer removes or replaces it", async () => {
    const { result, validate, ready, rerender } = setup()
    ready()
    await waitFor(() => expect(result.current.promoCodeValid).toBe(true))
    act(() => result.current.clearPromoCode())
    rerender({ salesFlowId: "flow-friends", releaseSettled: true })
    expect(result.current.promoCode).toBe("")
    expect(validate).toHaveBeenCalledTimes(1)
    await act(async () => {
      await result.current.applyPromoCode("OTHER20")
    })
    expect(result.current.promoCode).toBe("OTHER20")
    expect(validate).toHaveBeenCalledTimes(2)
  })

  it("keeps a code the buyer manually applied before restoration settled", async () => {
    const { result, validate, ready } = setup()
    await act(async () => {
      await result.current.applyPromoCode("MANUAL20")
    })
    ready()
    expect(result.current.promoCode).toBe("MANUAL20")
    expect(validate).toHaveBeenCalledExactlyOnceWith("MANUAL20")
  })

  it("revalidates for a new flow and ignores the old flow's in-flight response", async () => {
    const { result, validate, setDiscount, ready, rerender } = setup()
    let resolveOld!: (value: number) => void
    validate.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveOld = resolve
      }),
    )
    ready()
    expect(result.current.promoIsLoading).toBe(true)

    rerender({ salesFlowId: "flow-other", releaseSettled: true })
    await waitFor(() => expect(result.current.promoCodeValid).toBe(true))
    expect(validate).toHaveBeenCalledTimes(2)
    expect(setDiscount).toHaveBeenCalledTimes(1)

    await act(async () => resolveOld(50))
    expect(result.current.promoCodeDiscount).toBe(20)
    expect(result.current.promoError).toBeNull()
    expect(setDiscount).toHaveBeenCalledTimes(1)
  })
})
