"use client"

import type { CheckoutRuntimeProduct, PopupPublic } from "@/client"

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
