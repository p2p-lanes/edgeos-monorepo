// Thin React selectors over the framework-agnostic store. Each hook subscribes
// to the whole state via useSyncExternalStore (the store returns a stable
// snapshot ref between changes, so no selector-memoization pitfalls) and exposes
// the relevant slice plus the store's stable action methods.

import type { CheckoutStoreState } from "@edgeos/checkout-core"
import { useSyncExternalStore } from "react"
import { useCheckoutStore } from "./context"

/** Subscribe to the full checkout state. */
export function useCheckoutState(): CheckoutStoreState {
  const store = useCheckoutStore()
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}

/** Steps, navigation, submit + top-level flow state. */
export function useCheckout() {
  const store = useCheckoutStore()
  const state = useCheckoutState()
  return {
    steps: state.steps,
    currentStep: state.currentStep,
    submitting: state.submitting,
    error: state.error,
    runtime: state.runtime,
    goToStep: store.goToStep,
    nextStep: store.nextStep,
    previousStep: store.previousStep,
    submit: store.submit,
  }
}

/** Cart selection + mutators. Totals come from usePreview (server-authoritative). */
export function useCart() {
  const store = useCheckoutStore()
  const state = useCheckoutState()
  return {
    selection: state.selection,
    quantities: state.selection.quantities,
    housing: state.selection.housing,
    insurance: state.selection.insurance,
    setQuantity: store.setQuantity,
    selectProduct: store.selectProduct,
    selectHousing: store.selectHousing,
    setHousingQuantity: store.setHousingQuantity,
    clearHousing: store.clearHousing,
    setInsurance: store.setInsurance,
  }
}

/** Available steps + navigation only. */
export function useSteps() {
  const store = useCheckoutStore()
  const state = useCheckoutState()
  return {
    steps: state.steps,
    currentStep: state.currentStep,
    goToStep: store.goToStep,
    nextStep: store.nextStep,
    previousStep: store.previousStep,
  }
}

/** The server-authoritative price breakdown + its load status. */
export function usePreview() {
  const state = useCheckoutState()
  return {
    status: state.pricing.status,
    preview: state.pricing.preview,
    error: state.pricing.error,
    total: state.pricing.preview?.total ?? null,
  }
}

/** Buyer form values + coupon actions. */
export function useBuyerForm() {
  const store = useCheckoutStore()
  const state = useCheckoutState()
  return {
    values: state.buyer.values,
    setBuyer: store.setBuyer,
    coupon: state.coupon,
    applyCoupon: store.applyCoupon,
    clearCoupon: store.clearCoupon,
  }
}
