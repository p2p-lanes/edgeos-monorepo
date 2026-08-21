"use client"

import { useQuery } from "@tanstack/react-query"
import {
  type BuyerInfo,
  type CheckoutPreviewRequest,
  CheckoutService,
} from "@/client"
import { useCheckout } from "@/providers/checkoutProvider"
import type { CheckoutCartState } from "@/types/checkout"

type ProductQuantity = { productId: string; quantity?: number }

function collectQuantity(
  quantities: Map<string, number>,
  item: ProductQuantity | null,
) {
  if (!item?.productId) return
  quantities.set(
    item.productId,
    (quantities.get(item.productId) ?? 0) + (item.quantity ?? 1),
  )
}

export function buildOpenCheckoutPreviewRequest(
  cart: CheckoutCartState,
): CheckoutPreviewRequest {
  const quantities = new Map<string, number>()
  for (const pass of cart.passes) collectQuantity(quantities, pass)
  collectQuantity(quantities, cart.housing)
  for (const merch of cart.merch) collectQuantity(quantities, merch)
  collectQuantity(quantities, cart.patron)
  for (const mealPlan of cart.mealPlans) collectQuantity(quantities, mealPlan)
  for (const items of Object.values(cart.dynamicItems)) {
    for (const item of items) collectQuantity(quantities, item)
  }

  return {
    products: [...quantities].map(([product_id, quantity]) => ({
      product_id,
      quantity,
    })),
    coupon_code: cart.promoCode || null,
    insurance: cart.insurance,
  }
}

export function useOpenCheckoutQuote({
  popupSlug,
  flowSlug,
}: {
  popupSlug: string
  flowSlug: string | undefined
}) {
  const { cart, buyerValues, isBuyerInfoComplete } = useCheckout()
  const request = buildOpenCheckoutPreviewRequest(cart)
  const buyer = isBuyerInfoComplete
    ? {
        email: String(buyerValues.email ?? ""),
        first_name: String(buyerValues.first_name ?? ""),
        last_name: String(buyerValues.last_name ?? ""),
        form_data: buyerValues,
      }
    : null

  return useQuery({
    queryKey: [
      "checkout",
      "preview",
      popupSlug,
      flowSlug ?? null,
      request,
      buyer,
    ],
    queryFn: () =>
      CheckoutService.previewOpenTicketing({
        slug: popupSlug,
        flowSlug,
        requestBody: { ...request, buyer: buyer as BuyerInfo | null },
      }),
    enabled: request.products.length > 0,
    staleTime: 0,
  })
}
