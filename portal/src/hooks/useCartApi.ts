import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useEffect, useRef } from "react"
import { OpenAPI, type PaymentRecipientRequest } from "@/client"
import { request } from "@/client/core/request"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"

export type CartAssignment =
  | { kind: "unassigned" }
  | { kind: "attendee"; attendee_id: string }
  | { kind: "recipient"; recipient_key: string }

interface CartLineBase {
  assignment: CartAssignment
  step_type: string | null
}

export interface CartProductLine extends CartLineBase {
  kind: "product"
  product_id: string
  quantity: number
  price: number | null
}

export interface CartDateRangeLine extends CartLineBase {
  kind: "date_range"
  product_id: string
  check_in: string
  check_out: string
  quantity: number
}

export interface CartCustomAmountLine extends CartLineBase {
  kind: "custom_amount"
  product_id: string
  amount: number
  is_custom_amount: boolean
}

export interface CartMealPlanLine extends CartLineBase {
  kind: "meal_plan"
  product_id: string
  daily_choices: Record<string, string> | null
  dietary_restriction: string | null
  special_request: string | null
}

export interface CartAccommodationLine extends CartLineBase {
  kind: "accommodation"
  accommodation_id: string
  check_in: string
  check_out: string
  guest_count: number | null
  guests: string[]
}

export type CartLine =
  | CartProductLine
  | CartDateRangeLine
  | CartCustomAmountLine
  | CartMealPlanLine
  | CartAccommodationLine

export interface CartState {
  lines: CartLine[]
  recipients: PaymentRecipientRequest[]
  promo_code: string | null
  insurance: boolean
  current_step: string | null
}

interface CartPublic {
  id: string
  human_id: string
  popup_id: string
  items: CartState
  created_at: string
  updated_at: string
}

export const EMPTY_CART: CartState = {
  lines: [],
  recipients: [],
  promo_code: null,
  insurance: false,
  current_step: null,
}

export function useCart(popupId: string | null, salesFlowId?: string | null) {
  const isAuthenticated = useIsAuthenticated()
  return useQuery({
    queryKey: queryKeys.cart.byPopup(popupId ?? "", salesFlowId),
    queryFn: async (): Promise<CartState> => {
      const result = await request<CartPublic | null>(OpenAPI, {
        method: "GET",
        url: "/api/v1/carts/my/{popup_id}",
        path: { popup_id: popupId! },
        query: { sales_flow_id: salesFlowId ?? undefined },
      })
      return result?.items ?? EMPTY_CART
    },
    enabled: !!popupId && isAuthenticated,
    staleTime: 30_000,
  })
}

export function useSaveCart(
  popupId: string | null,
  salesFlowId?: string | null,
) {
  const queryClient = useQueryClient()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cartScope = popupId ? `${popupId}:${salesFlowId ?? ""}` : null
  const mutationRef =
    useRef<ReturnType<typeof useMutation<CartPublic, Error, CartState>>>(null)

  const mutation = useMutation({
    mutationFn: async (items: CartState) => {
      return request<CartPublic>(OpenAPI, {
        method: "PUT",
        url: "/api/v1/carts/my/{popup_id}",
        path: { popup_id: popupId! },
        query: { sales_flow_id: salesFlowId ?? undefined },
        body: { items },
      })
    },
    onSuccess: (_data, variables) => {
      queryClient.setQueryData(
        queryKeys.cart.byPopup(popupId ?? "", salesFlowId),
        variables,
      )
    },
  })
  mutationRef.current = mutation

  // Never let a pending save created for one door execute after navigation to
  // another door of the same popup.
  useEffect(() => {
    if (!cartScope) return
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }
    }
  }, [cartScope])

  const debouncedSave = useCallback(
    (items: CartState) => {
      if (!popupId) return

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }

      debounceRef.current = setTimeout(() => {
        mutationRef.current?.mutate(items)
      }, 500)
    },
    [popupId],
  )

  const saveImmediate = useCallback(
    (items: CartState) => {
      if (!popupId) return

      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
        debounceRef.current = null
      }

      // Optimistically update the RQ cache before the server responds
      queryClient.setQueryData(
        queryKeys.cart.byPopup(popupId, salesFlowId),
        items,
      )
      mutationRef.current?.mutate(items)
    },
    [popupId, queryClient, salesFlowId],
  )

  const cancelPendingSave = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
      debounceRef.current = null
    }
  }, [])

  return { save: debouncedSave, saveImmediate, cancelPendingSave, ...mutation }
}

export function useClearCart(
  popupId: string | null,
  salesFlowId?: string | null,
) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      return request<void>(OpenAPI, {
        method: "DELETE",
        url: "/api/v1/carts/my/{popup_id}",
        path: { popup_id: popupId! },
        query: { sales_flow_id: salesFlowId ?? undefined },
      })
    },
    onSuccess: () => {
      queryClient.setQueryData(
        queryKeys.cart.byPopup(popupId ?? "", salesFlowId),
        EMPTY_CART,
      )
    },
  })
}
