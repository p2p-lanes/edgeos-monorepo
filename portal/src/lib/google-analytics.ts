"use client"

import type { PaymentPortalPublic } from "@/client"

type GtagWindow = Window & { gtag?: (...args: unknown[]) => void }

export type GABrowserIds = {
  ga_client_id?: string
  ga_session_id?: string
}

function getGAField(
  gtag: (...args: unknown[]) => void,
  measurementId: string,
  field: "client_id" | "session_id",
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => resolve(undefined), 300)
    try {
      gtag("get", measurementId, field, (value: unknown) => {
        window.clearTimeout(timeout)
        resolve(
          typeof value === "string" || typeof value === "number"
            ? String(value)
            : undefined,
        )
      })
    } catch {
      window.clearTimeout(timeout)
      resolve(undefined)
    }
  })
}

/** Capture GA's existing browser identity; never synthesize an unrelated ID. */
export async function getGABrowserIds(
  measurementId: string | null | undefined,
): Promise<GABrowserIds> {
  if (
    typeof window === "undefined" ||
    !measurementId ||
    !/^G-[A-Z0-9]+$/i.test(measurementId)
  ) {
    return {}
  }
  const gtag = (window as GtagWindow).gtag
  if (typeof gtag !== "function") return {}

  const [clientId, sessionId] = await Promise.all([
    getGAField(gtag, measurementId, "client_id"),
    getGAField(gtag, measurementId, "session_id"),
  ])
  return {
    ...(clientId &&
      /^[A-Za-z0-9._-]{1,128}$/.test(clientId) && {
        ga_client_id: clientId,
      }),
    ...(sessionId &&
      /^\d{1,20}$/.test(sessionId) && {
        ga_session_id: sessionId,
      }),
  }
}

type GAProduct = {
  id: string
  name?: string | null
  price: number | string
  currency?: string | null
  category?: string | null
  is_active?: boolean
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

function getProductItems(products: GAProduct[]): GAItem[] {
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
  if (typeof window === "undefined") return false
  const gtag = (window as GtagWindow).gtag
  if (typeof gtag !== "function") return false

  try {
    gtag("event", eventName, params)
    return true
  } catch {
    // Marketing integrations must never interrupt a cart or payment action.
    return false
  }
}

export function trackGAViewItem(params: {
  popup: GAPopup
  products: GAProduct[]
}) {
  const items = getProductItems(params.products)
  const value = items.reduce((total, item) => total + item.price, 0)

  return trackGAEvent("view_item", {
    ...getPopupParams(params.popup),
    currency: params.popup.currency,
    value,
    items,
  })
}

export function trackGABeginCheckout(params: {
  popup: GAPopup
  items: Array<{ product_id: string; quantity?: number }>
  products: GAProduct[]
  coupon?: string
}) {
  const catalog = new Map(
    params.products.map((product) => [product.id, product]),
  )
  const items = params.items
    .filter((line) => (line.quantity ?? 1) > 0)
    .map((line) => {
      const product = catalog.get(line.product_id)
      const price = product ? Number(product.price) : undefined
      return {
        item_id: line.product_id,
        quantity: line.quantity ?? 1,
        ...(product?.name && { item_name: product.name }),
        ...(product?.category && { item_category: product.category }),
        ...(price !== undefined && Number.isFinite(price) && { price }),
      }
    })
  if (!items.length) return false
  const hasPrices = items.every((item) => item.price !== undefined)
  return trackGAEvent("begin_checkout", {
    ...getPopupParams(params.popup),
    ...(params.popup.currency && { currency: params.popup.currency }),
    ...(hasPrices &&
      params.popup.currency && {
        value: items.reduce(
          (total, item) => total + (item.price ?? 0) * item.quantity,
          0,
        ),
      }),
    ...(params.coupon && { coupon: params.coupon }),
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
