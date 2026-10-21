"use client"

import type {
  CheckoutRuntimeProduct,
  PaymentPortalPublic,
  PopupPublic,
} from "@/client"

type GtagWindow = Window & { gtag?: (...args: unknown[]) => void }

type GAProduct = {
  id: string
  name?: string | null
  price: number | string
  currency?: string | null
  category?: string | null
}

type GAPopup = {
  id: string
  slug: string
  name?: string | null
  currency?: string | null
}

type GAItem = {
  item_id: string
  item_name?: string | null
  item_category?: string | null
  quantity: number
  price: number
}

function getPopupParams(popup: GAPopup) {
  return {
    popup_id: popup.id,
    popup_slug: popup.slug,
    popup_name: popup.name,
  }
}

function getProductItems(products: CheckoutRuntimeProduct[]): GAItem[] {
  return products
    .filter((product) => product.is_active !== false)
    .map((product) => ({
      item_id: product.id,
      item_name: product.name,
      quantity: 1,
      price: Number(product.price),
    }))
}

export function trackGAEvent(
  eventName: string,
  params: Record<string, unknown>,
) {
  if (typeof window === "undefined") return
  const gtag = (window as GtagWindow).gtag
  if (typeof gtag !== "function") return

  gtag("event", eventName, params)
}

export function trackGAViewItem(params: {
  popup: PopupPublic
  products: CheckoutRuntimeProduct[]
}) {
  const items = getProductItems(params.products)
  const value = items.reduce((total, item) => total + item.price, 0)

  trackGAEvent("view_item", {
    ...getPopupParams(params.popup),
    currency: params.popup.currency,
    value,
    items,
  })
}

export function trackGACheckoutStep(params: {
  popup: GAPopup
  stepNumber: number
  stepId: string
  stepType: string
  stepName: string
}) {
  trackGAEvent("checkout_step", {
    ...getPopupParams(params.popup),
    step_number: params.stepNumber,
    step_id: params.stepId,
    step_type: params.stepType,
    step_name: params.stepName,
  })
}

export function trackGAApplicationEvent(params: {
  eventName: "application_draft_saved" | "application_submitted"
  popup: GAPopup
  applicationId: string
  salesFlowId: string | null
}) {
  trackGAEvent(params.eventName, {
    ...getPopupParams(params.popup),
    application_id: params.applicationId,
    ...(params.salesFlowId && { sales_flow_id: params.salesFlowId }),
  })
}

export function trackGAAddToCart(params: {
  popup: GAPopup
  product: GAProduct
  quantity: number
}) {
  if (params.quantity <= 0) return

  const unitPrice = Number(params.product.price)

  trackGAEvent("add_to_cart", {
    ...getPopupParams(params.popup),
    currency: params.product.currency ?? params.popup.currency,
    value: unitPrice * params.quantity,
    items: [
      {
        item_id: params.product.id,
        item_name: params.product.name,
        item_category: params.product.category,
        quantity: params.quantity,
        price: unitPrice,
      },
    ],
  })
}

export function trackGAPurchase(params: {
  paymentId: string
  popup: GAPopup
  amount: number | string
  currency: string
  products: Array<{ product_id: string; quantity?: number }>
}) {
  const items: GAItem[] = params.products.map((product) => ({
    item_id: product.product_id,
    quantity: product.quantity ?? 1,
    price: 0,
  }))

  trackGAEvent("purchase", {
    ...getPopupParams(params.popup),
    transaction_id: params.paymentId,
    currency: params.currency,
    value: Number(params.amount),
    items,
  })
}

/** A fee is a separate transaction from any subsequent booking purchase. */
export function trackGAApplicationFeePurchase(params: {
  payment: PaymentPortalPublic
  popupName?: string | null
}) {
  const { payment } = params
  const amount = Number(payment.amount_charged ?? payment.amount)
  if (
    payment.payment_type !== "application_fee" ||
    payment.status !== "approved" ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    typeof window === "undefined" ||
    typeof (window as GtagWindow).gtag !== "function"
  ) {
    return
  }

  const storageKey = `edgeos_ga4_fee_purchase_${payment.id}`
  try {
    if (window.localStorage.getItem(storageKey)) return
  } catch {
    // Storage may be unavailable; GA4 still deduplicates by transaction_id.
  }

  trackGAEvent("purchase", {
    popup_id: payment.popup_id,
    ...(params.popupName && { popup_name: params.popupName }),
    application_id: payment.application_id,
    transaction_id: payment.id,
    currency: payment.currency ?? "USD",
    value: amount,
    items: [
      {
        item_id: "application_fee",
        item_name: params.popupName ?? "Application fee",
        quantity: 1,
        price: amount,
      },
    ],
  })

  try {
    window.localStorage.setItem(storageKey, "1")
  } catch {
    // Event was already sent; storage is only an extra deduplication guard.
  }
}
