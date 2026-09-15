"use client"

import AddAttendeeButtons from "@/components/checkout-flow/shared/AddAttendeeButtons"
import {
  getStepAttendeeCategoryIds,
  isSectionVisibleForApp,
  parseSections,
} from "@/hooks/checkout/ticketSections"
import { useApplication } from "@/providers/applicationProvider"
import { useCheckout } from "@/providers/checkoutProvider"

interface TicketRecipientContext {
  sections: ReturnType<typeof parseSections>
  salesFlowId: string | null
}

export function useTicketRecipientContext(
  templateConfig?: Record<string, unknown> | null,
): TicketRecipientContext {
  const { salesFlowId } = useCheckout()
  const { getRelevantApplication } = useApplication()
  const application = getRelevantApplication(salesFlowId ?? undefined)
  const sections = parseSections(templateConfig).filter((section) =>
    isSectionVisibleForApp(section, application?.custom_fields ?? null),
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
