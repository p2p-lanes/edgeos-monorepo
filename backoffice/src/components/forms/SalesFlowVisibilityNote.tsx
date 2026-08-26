import type { SalesFlowType } from "@/client"

interface SalesFlowVisibilityNoteProps {
  type: SalesFlowType
}

function noteFor(type: SalesFlowType): string | null {
  if (type === "upsale") {
    return "Upsale flows appear on the portal passes page, only to signed-in buyers with an approved payment in this event. They are not listed in the application flow picker."
  }
  if (type === "direct") {
    return null
  }
  return "This flow appears in the portal's application flow picker whenever the event lists more than one application flow. With a single application flow, buyers land here directly."
}

/**
 * Compact, type-aware explainer placed next to the type field
 * so operators know where a flow actually surfaces before they publish it.
 */
export function SalesFlowVisibilityNote({
  type,
}: SalesFlowVisibilityNoteProps) {
  const note = noteFor(type)
  if (!note) return null

  return (
    <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
      {note}
    </p>
  )
}
