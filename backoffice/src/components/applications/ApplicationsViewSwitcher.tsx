import { StretchHorizontal, Table } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type ApplicationsView = "default" | "wide"

interface ApplicationsViewSwitcherProps {
  view: ApplicationsView
  onViewChange: (view: ApplicationsView) => void
  className?: string
}

export function ApplicationsViewSwitcher({
  view,
  onViewChange,
  className,
}: ApplicationsViewSwitcherProps) {
  return (
    <div
      className={cn("inline-flex rounded-md border bg-card p-0.5", className)}
    >
      <Button
        type="button"
        variant={view === "default" ? "default" : "ghost"}
        size="sm"
        aria-label="Default width"
        title="Default width"
        aria-pressed={view === "default"}
        onClick={() => onViewChange("default")}
        className={cn(
          "h-7 w-7 rounded-sm p-0",
          view === "default" && "shadow-none",
        )}
      >
        <Table className="h-4 w-4" />
      </Button>
      <Button
        type="button"
        variant={view === "wide" ? "default" : "ghost"}
        size="sm"
        aria-label="Wide"
        title="Wide"
        aria-pressed={view === "wide"}
        onClick={() => onViewChange("wide")}
        className={cn(
          "h-7 w-7 rounded-sm p-0",
          view === "wide" && "shadow-none",
        )}
      >
        <StretchHorizontal className="h-4 w-4" />
      </Button>
    </div>
  )
}
