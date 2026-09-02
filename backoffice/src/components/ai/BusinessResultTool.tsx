import { Link } from "@tanstack/react-router"
import {
  ArrowUpRight,
  CalendarDays,
  CreditCard,
  Package,
  UserRound,
  UsersRound,
} from "lucide-react"
import type { ComponentType } from "react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { type GenericToolPart, isObject } from "./tool-types"

type BusinessResource =
  | "application"
  | "attendee"
  | "product"
  | "payment"
  | "event"
  | "human"

type BusinessResultItem = {
  id: string
  primary: string
  secondary?: string
  meta?: string
  status?: string
}

export type BusinessResults = {
  resource: BusinessResource
  label: string
  items: BusinessResultItem[]
  total: number
  gatherings: string[]
  crossContext: boolean
}

function stringValue(record: Record<string, unknown>, keys: string[]) {
  const key = keys.find(
    (candidate) =>
      typeof record[candidate] === "string" && Boolean(record[candidate]),
  )
  return key ? String(record[key]) : undefined
}

function personIdentity(record: Record<string, unknown>) {
  const nested = [record.human, record.user].find(isObject)
  const source = nested ?? record
  const name =
    stringValue(source, ["name", "full_name"]) ??
    [source.first_name, source.last_name]
      .filter((value): value is string =>
        Boolean(typeof value === "string" && value),
      )
      .join(" ")
  return {
    name: name || stringValue(source, ["email"]) || "Unnamed person",
    email: stringValue(source, ["email"]),
  }
}

function formatEnum(value?: string) {
  if (!value) return undefined
  return value
    .replace(/[_-]+/g, " ")
    .replace(/^\w/, (letter) => letter.toUpperCase())
}

function formatDate(value?: string) {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(date)
}

function formatMoney(value: unknown, currency: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined
  const amount = Number(value)
  if (!Number.isFinite(amount)) return String(value)
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: typeof currency === "string" ? currency : "USD",
    }).format(amount)
  } catch {
    return String(value)
  }
}

function resourceFromOperation(operationId: string): BusinessResource | null {
  const value = operationId.toLowerCase()
  if (value.includes("application")) return "application"
  if (value.includes("attendee")) return "attendee"
  if (value.includes("product")) return "product"
  if (value.includes("payment")) return "payment"
  if (value.includes("event")) return "event"
  if (value.includes("human")) return "human"
  return null
}

function itemFromRecord(
  resource: BusinessResource,
  record: Record<string, unknown>,
): BusinessResultItem | null {
  if (typeof record.id !== "string") return null
  const status = formatEnum(stringValue(record, ["status", "decision"]))

  if (resource === "application") {
    const person = personIdentity(record)
    return {
      id: record.id,
      primary: person.name,
      secondary: person.email,
      meta: formatDate(stringValue(record, ["submitted_at", "created_at"])),
      status,
    }
  }
  if (resource === "attendee") {
    const person = personIdentity(record)
    return {
      id: record.id,
      primary: person.name,
      secondary: person.email,
      meta: formatEnum(stringValue(record, ["category"])),
      status,
    }
  }
  if (resource === "product") {
    return {
      id: record.id,
      primary: stringValue(record, ["name", "title"]) ?? "Unnamed product",
      secondary: formatMoney(record.price, record.currency),
      meta: formatEnum(stringValue(record, ["category", "product_type"])),
      status:
        typeof record.is_active === "boolean"
          ? record.is_active
            ? "Active"
            : "Inactive"
          : status,
    }
  }
  if (resource === "payment") {
    const person = personIdentity(record)
    return {
      id: record.id,
      primary:
        formatMoney(record.amount ?? record.total, record.currency) ??
        "Payment",
      secondary:
        stringValue(record, ["email", "buyer_email", "external_id"]) ??
        person.email,
      meta: formatDate(stringValue(record, ["created_at"])),
      status,
    }
  }
  if (resource === "event") {
    return {
      id: record.id,
      primary: stringValue(record, ["name", "title"]) ?? "Unnamed event",
      secondary: stringValue(record, ["venue_name", "location"]),
      meta: formatDate(
        stringValue(record, ["start_time", "starts_at", "date"]),
      ),
      status,
    }
  }
  const person = personIdentity(record)
  return {
    id: record.id,
    primary: person.name,
    secondary: person.email,
    meta: formatEnum(stringValue(record, ["rating"])),
    status: record.red_flag === true ? "Needs attention" : status,
  }
}

export function parseBusinessResults(
  part: GenericToolPart,
): BusinessResults | null {
  if (part.type !== "tool-executeOperation" || !isObject(part.output)) {
    return null
  }
  if (!isObject(part.output.operation)) return null
  const operationId = part.output.operation.operationId
  const summary = part.output.operation.summary
  const method = part.output.operation.method
  if (
    typeof operationId !== "string" ||
    typeof summary !== "string" ||
    method !== "GET" ||
    !/\blist\b|directory|pending/i.test(`${operationId} ${summary}`)
  ) {
    return null
  }
  const resource = resourceFromOperation(operationId)
  if (!resource || !isObject(part.output.data)) return null
  const data = part.output.data
  const records = Array.isArray(data.results)
    ? data.results
    : Array.isArray(data.items)
      ? data.items
      : []
  const items = records
    .filter(isObject)
    .map((record) => itemFromRecord(resource, record))
    .filter((item): item is BusinessResultItem => item !== null)
  if (!items.length) return null
  const paging = isObject(data.paging) ? data.paging : null
  const total =
    paging && typeof paging.total === "number" ? paging.total : items.length
  const context = isObject(part.output.context) ? part.output.context : null
  const targetGatherings = context?.targetGatherings
  const gatherings = Array.isArray(targetGatherings)
    ? targetGatherings.flatMap((gathering) =>
        isObject(gathering) && typeof gathering.name === "string"
          ? [gathering.name]
          : [],
      )
    : []
  const labels: Record<BusinessResource, string> = {
    application: "applications",
    attendee: "attendees",
    product: "products",
    payment: "payments",
    event: "events",
    human: "people",
  }
  return {
    resource,
    label: labels[resource],
    items: items.slice(0, 5),
    total,
    gatherings,
    crossContext: context?.crossContext === true,
  }
}

const ICONS: Record<BusinessResource, ComponentType<{ className?: string }>> = {
  application: UserRound,
  attendee: UsersRound,
  product: Package,
  payment: CreditCard,
  event: CalendarDays,
  human: UserRound,
}

function ResultLink({
  resource,
  id,
  onNavigate,
  label = "View",
}: {
  resource: BusinessResource
  id: string
  onNavigate: () => void
  label?: string
}) {
  const className =
    "inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
  if (resource === "application") {
    return (
      <Link
        to="/applications/$id"
        params={{ id }}
        className={className}
        onClick={onNavigate}
      >
        {label} <ArrowUpRight className="size-3" />
      </Link>
    )
  }
  if (resource === "attendee") {
    return (
      <Link
        to="/attendees/$attendeeId"
        params={{ attendeeId: id }}
        className={className}
        onClick={onNavigate}
      >
        View <ArrowUpRight className="size-3" />
      </Link>
    )
  }
  if (resource === "product") {
    return (
      <Link
        to="/products/$id/edit"
        params={{ id }}
        className={className}
        onClick={onNavigate}
      >
        View <ArrowUpRight className="size-3" />
      </Link>
    )
  }
  if (resource === "event") {
    return (
      <Link
        to="/events/$eventId"
        params={{ eventId: id }}
        className={className}
        onClick={onNavigate}
      >
        View <ArrowUpRight className="size-3" />
      </Link>
    )
  }
  if (resource === "human") {
    return (
      <Link
        to="/humans/$id"
        params={{ id }}
        className={className}
        onClick={onNavigate}
      >
        View <ArrowUpRight className="size-3" />
      </Link>
    )
  }
  return (
    <Link to="/payments" className={className} onClick={onNavigate}>
      Open payments <ArrowUpRight className="size-3" />
    </Link>
  )
}

export function BusinessResultTool({
  results,
  onNavigate,
}: {
  results: BusinessResults
  onNavigate: () => void
}) {
  const Icon = ICONS[results.resource]
  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
      <div className="flex items-center gap-2 border-b px-3.5 py-3">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Icon className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {results.total} {results.label}
          </p>
          {results.total > results.items.length && (
            <p className="text-[10px] text-muted-foreground">
              Showing the first {results.items.length}
            </p>
          )}
          {results.gatherings.length > 0 && (
            <p
              className={cn(
                "text-[10px] text-muted-foreground",
                results.crossContext && "font-medium text-warning",
              )}
            >
              Gathering · {results.gatherings.join(", ")}
            </p>
          )}
        </div>
      </div>
      <div className="divide-y">
        {results.items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 px-3.5 py-3">
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="truncate text-sm font-medium">{item.primary}</p>
                {item.status && (
                  <Badge variant="secondary" className="shrink-0 text-[9px]">
                    {item.status}
                  </Badge>
                )}
              </div>
              {(item.secondary || item.meta) && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {[item.secondary, item.meta].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <ResultLink
              resource={results.resource}
              id={item.id}
              label={
                results.resource === "application" &&
                item.status?.toLowerCase().includes("review")
                  ? "Review"
                  : "View"
              }
              onNavigate={onNavigate}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
