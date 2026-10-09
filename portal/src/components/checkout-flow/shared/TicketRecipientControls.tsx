"use client"

import AddAttendeeButtons from "@/components/checkout-flow/shared/AddAttendeeButtons"
import {
  filterTicketSectionsForRecipient,
  getBuyerPurchasedProductIds,
  getStepAttendeeCategoryIds,
  parseSections,
} from "@/hooks/checkout/ticketSections"
import { useApplication } from "@/providers/applicationProvider"
import { useCheckout } from "@/providers/checkoutProvider"
import { usePassesProvider } from "@/providers/passesProvider"

interface TicketRecipientContext {
  sections: ReturnType<typeof parseSections>
  salesFlowId: string | null
}

export function useTicketRecipientContext(
  templateConfig?: Record<string, unknown> | null,
): TicketRecipientContext {
  const { salesFlowId } = useCheckout()
  const { getRelevantApplication } = useApplication()
  const { attendeePasses } = usePassesProvider()
  const application = getRelevantApplication(salesFlowId ?? undefined)
  const purchasedProductIds = getBuyerPurchasedProductIds(attendeePasses)
  const sections = filterTicketSectionsForRecipient(
    parseSections(templateConfig),
    application?.custom_fields ?? null,
    application !== null,
    purchasedProductIds,
  )

  return { sections, salesFlowId }
}

export function TicketRecipientControls({
  context,
  onAttendeeAdded,
}: {
  context: TicketRecipientContext
  onAttendeeAdded?: (attendeeId: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <AddAttendeeButtons
        allowedCategoryIds={getStepAttendeeCategoryIds(context.sections)}
        onAttendeeAdded={onAttendeeAdded}
        salesFlowId={context.salesFlowId}
      />
    </div>
  )
}
