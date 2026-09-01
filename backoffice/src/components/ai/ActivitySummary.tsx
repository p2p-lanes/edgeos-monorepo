import {
  AlertTriangle,
  Check,
  ChevronRight,
  CircleEllipsis,
  Loader2,
  Search,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { type GenericToolPart, isObject } from "./tool-types"

type ActivityItem = {
  id: string
  label: string
  detail?: string
  state: "working" | "complete" | "failed"
  kind: "search" | "read" | "operation"
}

function humanize(value: string) {
  return value
    .replace(/^tool-/, "")
    .replace(/_[a-z0-9]+_api_v1_.+$/i, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function outputOperation(part: GenericToolPart) {
  if (!isObject(part.output) || !isObject(part.output.operation)) return null
  const operation = part.output.operation
  if (
    typeof operation.method !== "string" ||
    typeof operation.summary !== "string"
  ) {
    return null
  }
  return {
    method: operation.method,
    summary: operation.summary,
    status: typeof part.output.status === "number" ? part.output.status : null,
  }
}

function searchCount(part: GenericToolPart) {
  if (!isObject(part.output)) return null
  if (typeof part.output.resultCount === "number")
    return part.output.resultCount
  if (Array.isArray(part.output.operations))
    return part.output.operations.length
  return part.output.operation ? 1 : 0
}

function activityItem(part: GenericToolPart, index: number): ActivityItem {
  const failed = part.state === "output-error"
  const complete =
    failed ||
    part.state === "output-available" ||
    part.state === "output-denied"
  const state = failed ? "failed" : complete ? "complete" : "working"

  if (part.type === "tool-searchOperations") {
    const count = searchCount(part)
    return {
      id: part.toolCallId ?? `search-${index}`,
      label: complete
        ? "Checked available actions"
        : "Checking available actions",
      detail:
        count === null
          ? undefined
          : `${count} matching action${count === 1 ? "" : "s"}`,
      state,
      kind: "search",
    }
  }

  const operation = outputOperation(part)
  if (operation) {
    const isRead = operation.method === "GET"
    return {
      id: part.toolCallId ?? `operation-${index}`,
      label: operation.summary,
      detail: `${operation.method}${operation.status ? ` · ${operation.status}` : ""}`,
      state,
      kind: isRead ? "read" : "operation",
    }
  }

  const operationId =
    isObject(part.input) && typeof part.input.operationId === "string"
      ? part.input.operationId
      : undefined
  return {
    id: part.toolCallId ?? `tool-${index}`,
    label: operationId ? humanize(operationId) : humanize(part.type),
    detail: failed ? part.errorText : undefined,
    state,
    kind: "operation",
  }
}

export function isBackgroundToolPart(part: GenericToolPart) {
  if (part.type === "tool-prepareCustomExport") return false
  if (part.type === "tool-searchOperations") return true
  if (part.type !== "tool-executeOperation") return true
  if (
    part.state === "approval-requested" ||
    part.state === "approval-responded" ||
    part.state === "output-denied" ||
    part.state === "output-error"
  ) {
    return false
  }
  const operation = outputOperation(part)
  return !operation || operation.method === "GET"
}

export function ActivitySummary({
  parts,
  streaming = false,
}: {
  parts: GenericToolPart[]
  streaming?: boolean
}) {
  const items = parts.map(activityItem)
  const failed = items.some((item) => item.state === "failed")
  const working = streaming || items.some((item) => item.state === "working")
  const readCount = items.filter((item) => item.kind === "read").length
  const searchCount = items.filter((item) => item.kind === "search").length
  const activeItem = [...items]
    .reverse()
    .find((item) => item.state === "working")
  const summary = working
    ? activeItem?.kind === "search"
      ? "Finding the right action…"
      : activeItem
        ? `${activeItem.label}…`
        : "Choosing the next step…"
    : failed
      ? "Needs attention"
      : [
          readCount ? `${readCount} read${readCount === 1 ? "" : "s"}` : null,
          searchCount
            ? `${searchCount} search${searchCount === 1 ? "" : "es"}`
            : null,
        ]
          .filter(Boolean)
          .join(" · ") || `${items.length} steps`

  return (
    <details className="group overflow-hidden rounded-lg border border-border/70 bg-muted/15">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 text-xs transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 [&::-webkit-details-marker]:hidden">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary",
            failed && "bg-destructive-soft text-destructive",
            !working && !failed && "bg-success-soft text-success",
          )}
        >
          {working ? (
            <Loader2 className="size-3.5 animate-spin" />
          ) : failed ? (
            <AlertTriangle className="size-3.5" />
          ) : (
            <Check className="size-3.5" />
          )}
        </span>
        <span className="font-medium">Activity</span>
        <span className="min-w-0 truncate text-muted-foreground">
          {summary}
        </span>
        <ChevronRight className="ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
      </summary>
      <div className="space-y-0.5 border-t px-3 py-2">
        {items.map((item) => (
          <div
            key={item.id}
            className="flex min-w-0 items-start gap-2 rounded-md px-1.5 py-1.5 text-xs"
          >
            {item.state === "working" ? (
              <CircleEllipsis className="mt-0.5 size-3.5 shrink-0 text-primary" />
            ) : item.state === "failed" ? (
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-destructive" />
            ) : item.kind === "search" ? (
              <Search className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Check className="mt-0.5 size-3.5 shrink-0 text-success" />
            )}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.detail && (
              <span className="shrink-0 font-mono text-[9px] text-muted-foreground">
                {item.detail}
              </span>
            )}
          </div>
        ))}
      </div>
    </details>
  )
}
