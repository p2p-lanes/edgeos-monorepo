"use client"

import { useQueries } from "@tanstack/react-query"
import { cartQueryOptions, EMPTY_CART } from "@/hooks/useCartApi"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import useResources from "@/hooks/useResources"
import { type CartSummary, summarizeCart } from "@/lib/cart-summary"
import { useCityProvider } from "@/providers/cityProvider"

export interface FlowCart {
  popupId: string
  flowId: string
  name: string
  path: string
  summary: CartSummary
  itemCount: number
}

/**
 * The saved cart of every checkout the sidebar offers. A cart belongs to one
 * sales flow, so no single request can say what the buyer has pending across
 * a gathering. Each query shares its key with the checkout's own cart, which
 * keeps these counts live while the buyer edits it.
 */
export function useFlowCarts(): FlowCart[] {
  const city = useCityProvider().getCity()
  const popupId = city?.id ? String(city.id) : null
  const isAuthenticated = useIsAuthenticated()
  const { resources } = useResources()
  const flows = resources.flatMap((resource) =>
    resource.salesFlowId && resource.path
      ? [
          {
            flowId: resource.salesFlowId,
            name: resource.name,
            path: resource.path,
          },
        ]
      : [],
  )

  const carts = useQueries({
    queries: flows.map((flow) => ({
      ...cartQueryOptions(popupId, flow.flowId),
      enabled: !!popupId && isAuthenticated,
    })),
  })

  if (!popupId) return []

  return flows.map((flow, index) => {
    const summary = summarizeCart(carts[index]?.data ?? EMPTY_CART)
    return { ...flow, popupId, summary, itemCount: summary.itemCount }
  })
}
