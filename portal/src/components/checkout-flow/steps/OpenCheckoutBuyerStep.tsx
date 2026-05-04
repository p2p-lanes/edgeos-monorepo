"use client"

import { OpenTicketingBuyerForm } from "@/app/checkout/[popupSlug]/components/OpenTicketingBuyerForm"
import { useCheckout } from "@/providers/checkoutProvider"

export default function OpenCheckoutBuyerStep() {
  const {
    buyerFormSchema,
    buyerValues,
    buyerErrors,
    setBuyerField,
    buyerGeneralError,
  } = useCheckout()

  if (!buyerFormSchema) {
    return null
  }

  return (
    <div className="space-y-4">
      <OpenTicketingBuyerForm
        schema={buyerFormSchema}
        values={buyerValues}
        errors={buyerErrors}
        onChange={setBuyerField}
      />

      {buyerGeneralError ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {buyerGeneralError}
        </div>
      ) : null}
    </div>
  )
}
