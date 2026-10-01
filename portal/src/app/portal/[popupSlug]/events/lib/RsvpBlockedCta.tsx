"use client"

import { Ticket } from "lucide-react"
import Link from "next/link"
import type { ReactNode } from "react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useBuyTicketsHref } from "./useBuyTicketsHref"
import type { RsvpBlockReason } from "./useCanRsvp"

interface RsvpBlockedCtaProps {
  /** Why RSVP is blocked. Only `no_tickets` gets a purchase CTA. */
  reason?: RsvpBlockReason
  /** The existing, unmodified disabled RSVP button. */
  children: ReactNode
  /** Explanation shown in the popover and as the wrapper's hover title. */
  message?: string
  className?: string
}

/**
 * Turns a blocked RSVP button into a tappable "why, and what now" surface.
 *
 * A disabled button is a dead end on touch: the `title` attribute and hover
 * tooltips the RSVP buttons relied on never fire there. So when the blocker
 * is a missing ticket we wrap the button in a clickable anchor that opens a
 * popover explaining the block and linking into the popup's purchase flow.
 *
 * Every other state passes straight through untouched. A rejected
 * application is not a sales opportunity, and the public calendar never
 * renders RSVP controls at all, so neither reaches the popover branch.
 */
export function RsvpBlockedCta({
  reason,
  children,
  message,
  className,
}: RsvpBlockedCtaProps) {
  if (reason !== "no_tickets") return <>{children}</>
  return (
    <BuyTicketPopover message={message} className={className}>
      {children}
    </BuyTicketPopover>
  )
}

/**
 * Split out so the sales-flow queries behind `useBuyTicketsHref` only ever
 * mount for a ticketless attendee, and so `RsvpBlockedCta` itself can bail
 * out before any hook runs.
 */
function BuyTicketPopover({
  children,
  message,
  className,
}: Omit<RsvpBlockedCtaProps, "reason">) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLSpanElement>(null)
  const buyHref = useBuyTicketsHref()

  // The event cards in the list and day views sit inside a <Link>, so the
  // wrapper has to swallow the click before it reaches the anchor. That rules
  // out PopoverTrigger, whose handler Radix skips once defaultPrevented is
  // set; an anchor plus our own handler keeps both behaviours.
  // Toggle, not open. Without a PopoverTrigger, Radix's DismissableLayer
  // counts this wrapper as outside the layer, so a second tap already fires
  // its dismiss; setting `true` here would immediately reopen it and the
  // popover could never be closed by tapping the thing that opened it.
  const togglePopover = (event: {
    preventDefault(): void
    stopPropagation(): void
  }) => {
    event.preventDefault()
    event.stopPropagation()
    setOpen((wasOpen) => !wasOpen)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        {/** biome-ignore lint/a11y/useSemanticElements: a real <button> cannot wrap the disabled RSVP button without nesting interactive elements */}
        <span
          ref={anchorRef}
          role="button"
          tabIndex={0}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={t("events.rsvp.why_blocked")}
          title={message}
          onClick={togglePopover}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") togglePopover(event)
          }}
          // The wrapped button is disabled, and disabled controls swallow
          // pointer events instead of letting them bubble. Making it
          // click-through hands the tap to this wrapper without touching the
          // button's own markup.
          className={cn(
            "inline-flex cursor-pointer rounded-md [&_button:disabled]:pointer-events-none",
            className,
          )}
        >
          {children}
        </span>
      </PopoverAnchor>
      <PopoverContent
        align="end"
        className="w-64 space-y-3"
        // PopoverContent renders through a React portal, so its events still
        // bubble up the React tree into the surrounding event-card <Link>.
        onClick={(event) => event.stopPropagation()}
        // Radix restores focus to its trigger, and there is no trigger here,
        // so focus would land on <body> and a keyboard user would lose their
        // place in the list. Put it back on the wrapper instead.
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          anchorRef.current?.focus()
        }}
      >
        <p className="text-sm text-muted-foreground">
          {message ?? t("events.rsvp.requires_ticket")}
        </p>
        {buyHref && (
          <Button asChild size="sm" className="w-full">
            <Link href={buyHref}>
              <Ticket className="h-4 w-4" />
              {t("cta.buy_tickets")}
            </Link>
          </Button>
        )}
      </PopoverContent>
    </Popover>
  )
}

export default RsvpBlockedCta
