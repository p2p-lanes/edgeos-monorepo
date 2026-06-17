"use client"

import type { CheckoutRuntimeProduct, PopupPublic } from "@/client"

type MetaWindow = Window & { fbq?: (...args: unknown[]) => void }

type MetaProduct = {
  id: string
  name?: string | null
  price: number | string
  currency?: string | null
  category?: string | null
}

type MetaPopup = {
  id: string
  slug: string
  name?: string | null
  currency?: string | null
}

const META_SESSION_ID_KEY = "edgeos_meta_session_id"

function getCookieValue(name: string) {
  if (typeof document === "undefined") return undefined

  const prefix = `${name}=`
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length)
}

export function getMetaAttribution() {
  return {
    fbc: getCookieValue("_fbc"),
    fbp: getCookieValue("_fbp"),
  }
}

function getMetaSessionId() {
  const existing = window.sessionStorage.getItem(META_SESSION_ID_KEY)
  if (existing) return existing

  const next = crypto.randomUUID()
  window.sessionStorage.setItem(META_SESSION_ID_KEY, next)
  return next
}

function getPopupParams(popup: MetaPopup) {
  return {
    popup_id: popup.id,
    popup_slug: popup.slug,
    popup_name: popup.name,
  }
}

function getProductParams(products: CheckoutRuntimeProduct[]) {
  const visibleProducts = products.filter(
    (product) => product.is_active !== false,
  )
  const firstProduct = visibleProducts[0]

  return {
    content_ids: visibleProducts.map((product) => product.id),
    content_name: firstProduct?.name,
    content_type: "product",
    contents: visibleProducts.map((product) => ({
      id: product.id,
      item_price: Number(product.price),
      quantity: 1,
    })),
    currency: firstProduct?.currency,
    value: firstProduct ? Number(firstProduct.price) : 0,
  }
}

function trackMetaEvent(
  eventName: string,
  params: Record<string, unknown>,
  eventID: string,
) {
  if (typeof window === "undefined") return
  const fbq = (window as MetaWindow).fbq
  if (typeof fbq !== "function") return

  fbq("track", eventName, params, { eventID })
}

export function trackMetaViewContent(params: {
  popup: PopupPublic
  products: CheckoutRuntimeProduct[]
}) {
  const eventID = `EVT_VIEW_${params.popup.id}_${getMetaSessionId()}`
  trackMetaEvent(
    "ViewContent",
    {
      ...getPopupParams(params.popup),
      ...getProductParams(params.products),
    },
    eventID,
  )
}

export function trackMetaAddToCart(params: {
  popup: MetaPopup
  product: MetaProduct
  quantity: number
}) {
  if (params.quantity <= 0) return

  const unitPrice = Number(params.product.price)
  const eventID = `EVT_CART_${params.popup.id}_${params.product.id}_${getMetaSessionId()}_${Date.now()}`
  trackMetaEvent(
    "AddToCart",
    {
      ...getPopupParams(params.popup),
      content_ids: [params.product.id],
      content_name: params.product.name,
      content_type: "product",
      content_category: params.product.category,
      contents: [
        {
          id: params.product.id,
          item_price: unitPrice,
          quantity: params.quantity,
        },
      ],
      currency: params.product.currency ?? params.popup.currency,
      num_items: params.quantity,
      value: unitPrice * params.quantity,
    },
    eventID,
  )
}

export function trackMetaPurchase(params: {
  paymentId: string
  popup: MetaPopup
  amount: number | string
  currency: string
  products: Array<{ product_id: string; quantity?: number }>
}) {
  const contents = params.products.map((product) => ({
    id: product.product_id,
    quantity: product.quantity ?? 1,
  }))

  trackMetaEvent(
    "Purchase",
    {
      ...getPopupParams(params.popup),
      content_ids: params.products.map((product) => product.product_id),
      content_type: "product",
      contents,
      currency: params.currency,
      num_items: contents.reduce((total, item) => total + item.quantity, 0),
      order_id: params.paymentId,
      value: Number(params.amount),
    },
    `EVT_PURCHASE_${params.paymentId}`,
  )
}
