import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useCallback, useRef } from "react"
import { OpenAPI } from "@/client"
import { request } from "@/client/core/request"
import { queryKeys } from "@/lib/query-keys"

export interface CartItemPass {
  attendee_id: string
  product_id: string
  quantity: number
}

export interface CartItemHousing {
  product_id: string
  check_in: string
  check_out: string
}

export interface CartItemMerch {
  product_id: string
  quantity: number
}

export interface CartItemPatron {
  product_id: string
  amount: number
  is_custom_amount: boolean
}

export interface CartState {
  passes: CartItemPass[]
  housing: CartItemHousing | null
  merch: CartItemMerch[]
  patron: CartItemPatron | null
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

const EMPTY_CART: CartState = {
  passes: [],
  housing: null,
  merch: [],
  patron: null,
  promo_code: null,
  insurance: false,
  current_step: null,
}

export function useCart(popupId: string | null) {
  return useQuery({
    queryKey: queryKeys.cart.byPopup(popupId ?? ""),
    queryFn: async (): Promise<CartState> => {
      const result = await request<CartPublic>(OpenAPI, {
        method: "GET",
        url: "/api/v1/carts/my/{popup_id}",
        path: { popup_id: popupId! },
      })
      return result.items ?? EMPTY_CART
    },
    enabled: !!popupId,
    staleTime: 30_000,
  })
}

export function useSaveCart(popupId: string | null) {
  const queryClient = useQueryClient()
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mutationRef =
    useRef<ReturnType<typeof useMutation<CartPublic, Error, CartState>>>(null)

  const mutation = useMutation({
    mutationFn: async (items: CartState) => {
      return request<CartPublic>(OpenAPI, {
        method: "PUT",
        url: "/api/v1/carts/my/{popup_id}",
        path: { popup_id: popupId! },
        body: { items },
      })
    },
    onSuccess: (_data, variables) => {
      queryClient.setQueryData(queryKeys.cart.byPopup(popupId ?? ""), variables)
    },
  })
  mutationRef.current = mutation

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

  return { save: debouncedSave, ...mutation }
}

export function useClearCart(popupId: string | null) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async () => {
      return request<void>(OpenAPI, {
        method: "DELETE",
        url: "/api/v1/carts/my/{popup_id}",
        path: { popup_id: popupId! },
      })
    },
    onSuccess: () => {
      queryClient.setQueryData(
        queryKeys.cart.byPopup(popupId ?? ""),
        EMPTY_CART,
      )
    },
  })
}
