import { Check, X } from "lucide-react"

export type AvailabilityState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available" }
  | { status: "unavailable"; reason?: string | null }
  | {
      status: "partially-unavailable"
      conflictCount: number
      firstConflict: { localLabel: string; titles: string[] }
      truncated: boolean
    }
  | { status: "error"; message: string }

function formatFirstConflict(c: {
  localLabel: string
  titles: string[]
}): string {
  if (c.titles.length === 0) return c.localLabel
  return `${c.localLabel} (${c.titles.join(", ")})`
}

export function AvailabilityIndicator({
  availability,
}: {
  availability: AvailabilityState
}) {
  if (availability.status === "idle") return null
  if (availability.status === "checking") {
    return (
      <p className="text-xs text-muted-foreground">Checking availability...</p>
    )
  }
  if (availability.status === "available") {
    return (
      <p className="flex items-center gap-1 text-xs text-green-600 dark:text-green-500">
        <Check className="h-3.5 w-3.5" /> Slot available
      </p>
    )
  }
  if (availability.status === "unavailable") {
    return (
      <p className="flex items-center gap-1 text-xs text-destructive">
        <X className="h-3.5 w-3.5" />{" "}
        {availability.reason ?? "Slot unavailable"}
      </p>
    )
  }
  if (availability.status === "partially-unavailable") {
    const { conflictCount, firstConflict, truncated } = availability
    let label: string
    if (truncated) {
      label = `Many occurrences conflict — first: ${formatFirstConflict(firstConflict)}`
    } else if (conflictCount === 1) {
      label = `One occurrence conflicts: ${formatFirstConflict(firstConflict)}`
    } else {
      label = `${conflictCount} occurrences conflict — first: ${formatFirstConflict(firstConflict)}`
    }
    return (
      <p className="flex items-center gap-1 text-xs text-destructive">
        <X className="h-3.5 w-3.5" /> {label}
      </p>
    )
  }
  return <p className="text-xs text-muted-foreground">{availability.message}</p>
}
