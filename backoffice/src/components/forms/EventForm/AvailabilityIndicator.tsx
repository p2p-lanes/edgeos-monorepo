import { Check, X } from "lucide-react"

export type AvailabilityState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available" }
  | { status: "unavailable"; reason?: string | null }
  | { status: "error"; message: string }

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
  return (
    <p className="text-xs text-muted-foreground">{availability.message}</p>
  )
}
