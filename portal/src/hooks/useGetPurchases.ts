import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import {
  type AttendeePurchases,
  type PaymentPublic,
  PaymentsService,
} from "@/client"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"
import type { AttendeePassState } from "@/types/Attendee"

type PurchaseAttendee = Pick<AttendeePassState, "id" | "name" | "category">

export function purchasesFromPayments(
  payments: Pick<PaymentPublic, "products_snapshot">[],
  attendees: PurchaseAttendee[],
): AttendeePurchases[] {
  const attendeesById = new Map(
    attendees.map((attendee) => [attendee.id, attendee]),
  )
  const purchasesByAttendee = new Map<string, AttendeePurchases>()

  for (const payment of payments) {
    for (const product of payment.products_snapshot ?? []) {
      const attendee = attendeesById.get(product.attendee_id)
      if (!attendee) continue

      const purchase = purchasesByAttendee.get(attendee.id) ?? {
        attendee_id: attendee.id,
        attendee_name: attendee.name,
        attendee_category: attendee.category ?? "main",
        products: [],
      }
      purchase.products?.push({
        id: product.product_id,
        name: product.product_name,
        price: product.product_price,
        category: product.product_category,
        quantity: product.quantity,
      } as NonNullable<AttendeePurchases["products"]>[number])
      purchasesByAttendee.set(attendee.id, purchase)
    }
  }

  return [...purchasesByAttendee.values()]
}

export function usePurchasesQuery(
  popupId: string | null,
  attendees: PurchaseAttendee[],
) {
  const isAuthenticated = useIsAuthenticated()
  const query = useQuery({
    queryKey: queryKeys.purchases.byPopup(popupId ?? ""),
    queryFn: () => PaymentsService.listMyPaymentsByPopup({ popupId: popupId! }),
    enabled: !!popupId && isAuthenticated,
  })

  const data = useMemo(
    () => purchasesFromPayments(query.data?.results ?? [], attendees),
    [query.data?.results, attendees],
  )

  return { ...query, data }
}
