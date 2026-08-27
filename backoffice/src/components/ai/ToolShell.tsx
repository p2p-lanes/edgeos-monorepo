import { Clock3 } from "lucide-react"
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

export function ToolShell({
  label,
  status,
  complete = false,
  warning = false,
  children,
}: {
  label: string
  status: string
  complete?: boolean
  warning?: boolean
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border bg-card shadow-xs",
        warning && "border-warning/40",
      )}
    >
      <div
        className={cn(
          "absolute inset-y-0 left-0 w-1 bg-primary",
          complete && "bg-success",
          warning && "bg-warning",
        )}
      />
      <div className="flex items-center justify-between border-b px-4 py-2.5 pl-5">
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em]">
          {label}
        </span>
        <Badge variant="outline" className="font-mono text-[10px] font-normal">
          {status}
        </Badge>
      </div>
      <div className="px-4 py-3.5 pl-5">{children}</div>
    </div>
  )
}

export function ExpiredPreparedFileTool({
  kind,
}: {
  kind: "custom-export" | "download"
}) {
  const exportFile = kind === "custom-export"
  return (
    <ToolShell
      label={exportFile ? "Custom export" : "Prepared download"}
      status="Expired"
      warning
    >
      <div className="flex items-start gap-3">
        <Clock3 className="mt-0.5 size-4 shrink-0 text-warning" />
        <div>
          <p className="text-sm font-medium">
            {exportFile ? "Prepared export expired" : "Prepared file expired"}
          </p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            For privacy, its plan and arguments were not saved in this browser.
            Ask EdgeOS to prepare it again.
          </p>
        </div>
      </div>
    </ToolShell>
  )
}

export function ToolError({ text }: { text: string }) {
  return (
    <ToolShell label="EdgeOS action" status="Failed" warning>
      <p className="text-sm text-destructive">{text}</p>
    </ToolShell>
  )
}
