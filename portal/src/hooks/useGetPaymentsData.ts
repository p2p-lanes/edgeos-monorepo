import type { PaymentProductResponse, PaymentPublic } from "@/client"
import useHumanPaymentsQuery from "@/hooks/useHumanPaymentsQuery"
import { useCityProvider } from "@/providers/cityProvider"
import type { PaymentsProps } from "@/types/passes"

function mapPayment(p: PaymentPublic): PaymentsProps {
  return {
    id: p.id,
    application_id: p.application_id ?? null,
    external_id: p.external_id ?? null,
    status: (p.status ?? "pending") as PaymentsProps["status"],
    amount: Number(p.amount ?? 0),
    rate: Number(p.rate ?? 0),
    source: p.source ?? null,
    currency: p.currency ?? "USD",
    checkout_url: p.checkout_url ?? null,
    products_snapshot: (p.products_snapshot ?? []).map(
      (ps: PaymentProductResponse) => ({
        product_id: ps.product_id,
        attendee_id: ps.attendee_id,
        quantity: ps.quantity ?? 1,
        product_name: ps.product_name ?? "",
        product_description: ps.product_description ?? null,
        product_price: Number(ps.product_price ?? 0),
        product_category: ps.product_category ?? "",
        created_at: ps.created_at ?? "",
      }),
    ),
    created_at: p.created_at ?? "",
    updated_at: p.updated_at ?? "",
  }
}

/**
 * Fetches all payments for the current Human in the current popup.
 *
 * Uses `GET /payments/my/popup/{popup_id}` which combines both
 * application-linked and direct-sale payments via the dual-path predicate.
 * The query is keyed by `queryKeys.payments.byPopup(popupId)`.
 *
 * The query is disabled when the city context is not available.
 */
const useGetPaymentsData = () => {
  const { getCity } = useCityProvider()
  const city = getCity()
  const popupId = city ? String(city.id) : null

  const { data: rawPayments = [] } = useHumanPaymentsQuery(popupId)

  const payments = rawPayments.map(mapPayment)

  return { payments }
}
export default useGetPaymentsData
