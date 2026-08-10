import type { ReactNode } from "react"

/**
 * Section header for one block of "Related records" (Human, Payments,
 * Attendees, Previous applications). Extracted so each block can live in its
 * own file and still share the exact same header treatment.
 */
export function ResourceHeader({
  id,
  icon,
  title,
  count,
  action,
}: {
  id: string
  icon: ReactNode
  title: string
  count?: number
  action?: ReactNode
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 px-1">
      <h3
        id={id}
        className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground"
      >
        {icon}
        {title}
        {count !== undefined && (
          <span className="font-mono text-[11px] tabular-nums">{count}</span>
        )}
      </h3>
      {action}
    </div>
  )
}

/** Shared styling for the "Open profile →" / "View all →" links in a header. */
export const resourceActionClassName =
  "inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
