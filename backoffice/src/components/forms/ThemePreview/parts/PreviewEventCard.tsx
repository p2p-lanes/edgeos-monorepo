import { CalendarDays, MapPin } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatDateRange } from "./dateFormat"
import { useDisplayEvent, usePreview } from "./PreviewContext"
import { PreviewProgressBar } from "./PreviewProgressBar"
import { makeIsHl, ringIf } from "./ring"

// Replica of portal/src/components/Card/EventCard.tsx. Horizontal layout:
// image placeholder on the left, content column (title, tagline, meta,
// progress, CTA) on the right.
export function PreviewEventCard() {
  const { highlightedKeys } = usePreview()
  const event = useDisplayEvent()
  const isHl = makeIsHl(highlightedKeys)

  return (
    <div
      className={cn(
        "overflow-hidden border shadow-sm",
        ringIf(isHl("card", "card_foreground", "border")),
      )}
      style={{
        backgroundColor: "var(--card)",
        color: "var(--card-foreground)",
        borderColor: "var(--border)",
        borderRadius: "var(--border-radius)",
      }}
    >
      <div className="flex">
        {/* Image placeholder: large initial on a muted background */}
        <div
          className="flex w-48 shrink-0 items-center justify-center"
          style={{ backgroundColor: "var(--muted)" }}
        >
          <span
            className="text-7xl font-bold"
            style={{
              color:
                "color-mix(in oklab, var(--muted-foreground) 55%, transparent)",
            }}
          >
            {event.initial}
          </span>
        </div>

        {/* Content */}
        <div className="flex flex-1 flex-col gap-3 p-6">
          <div>
            <h3
              className={cn(
                "text-2xl font-bold leading-tight",
                ringIf(isHl("heading", "pass_title")),
              )}
              style={{ color: "var(--heading)" }}
            >
              {event.name}
            </h3>
            <p
              className={cn(
                "mt-1 text-sm",
                ringIf(isHl("heading_secondary", "pass_text")),
              )}
              style={{ color: "var(--heading-secondary)" }}
            >
              {event.tagline}
            </p>
          </div>

          <div className="flex flex-col gap-1.5 text-sm">
            <div
              className="flex items-center gap-2"
              style={{ color: "var(--body)" }}
            >
              <MapPin
                className="h-3.5 w-3.5"
                style={{ color: "var(--muted-foreground)" }}
              />
              <span>{event.location}</span>
            </div>
            <div
              className="flex items-center gap-2"
              style={{ color: "var(--body)" }}
            >
              <CalendarDays
                className="h-3.5 w-3.5"
                style={{ color: "var(--muted-foreground)" }}
              />
              <span>{formatDateRange(event.start_date, event.end_date)}</span>
            </div>
          </div>

          <div className="mt-2">
            <PreviewProgressBar />
          </div>

          <div className="mt-1 flex justify-end">
            <button
              type="button"
              tabIndex={-1}
              className={cn(
                "inline-flex h-9 items-center justify-center rounded-md px-5 text-sm font-medium shadow",
                ringIf(isHl("primary", "primary_foreground")),
              )}
              style={{
                backgroundColor: "var(--primary)",
                color: "var(--primary-foreground)",
                borderRadius: "var(--radius)",
              }}
            >
              Ver pases
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
