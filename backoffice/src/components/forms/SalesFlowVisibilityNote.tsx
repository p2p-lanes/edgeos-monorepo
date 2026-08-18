import type { SalesFlowType, SalesFlowVisibility } from "@/client"

interface SalesFlowVisibilityNoteProps {
  type: SalesFlowType
  visibility: SalesFlowVisibility
}

function noteFor(type: SalesFlowType, visibility: SalesFlowVisibility): string {
  if (type === "upsale") {
    return "Upsale flows appear on the portal passes page, only to signed-in buyers with an approved payment in this event. They are not listed in the application flow picker."
  }
  if (type === "direct") {
    return visibility === "direct_url_only"
      ? "This flow is reachable only through its direct link shown above."
      : "This flow appears on the portal event overview and remains reachable through its direct link shown above."
  }
  return "This flow appears in the portal's application flow picker whenever the event lists more than one application flow. With a single application flow, buyers land here directly."
}

/**
 * Compact, type-aware explainer placed next to the type/visibility fields
 * so operators know where a flow actually surfaces before they publish it.
 */
export function SalesFlowVisibilityNote({
  type,
  visibility,
}: SalesFlowVisibilityNoteProps) {
  return (
    <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
      {noteFor(type, visibility)}
    </p>
  )
}
