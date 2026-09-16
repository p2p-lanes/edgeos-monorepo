"use client"

import { Loader } from "@/components/ui/Loader"
import useHumanPaymentsQuery from "@/hooks/useHumanPaymentsQuery"
import { useCityProvider } from "@/providers/cityProvider"
import { OrdersContent } from "./OrdersContent"

export default function OrdersPage() {
  const { getCity } = useCityProvider()
  const city = getCity()
  const payments = useHumanPaymentsQuery(city ? String(city.id) : null)

  if (!city || payments.isLoading) return <Loader />

  const invoiceAvailable = Boolean(
    city.invoice_company_name &&
      city.invoice_company_address &&
      city.invoice_company_email,
  )

  return (
    <OrdersContent
      payments={payments.data ?? []}
      invoiceAvailable={invoiceAvailable}
    />
  )
}
