"use client"

import { Download, X } from "lucide-react"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  type CalendarLinkInput,
  googleCalendarUrl,
  outlookCalendarUrl,
  yahooCalendarUrl,
} from "./calendarLinks"
import { downloadEventIcs } from "./downloadEventIcs"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  eventId: string
  /** Raw event fields used to build provider URLs. */
  event: CalendarLinkInput
  /** Fired when the user picks any provider (Google/Outlook/Yahoo/.ics).
   * Used by callers to flip a "Added to calendar" flag in localStorage. */
  onAdded?: () => void
  /** Whether the event is already marked as added. When true, the modal
   * surfaces a "Remove from my calendar" action that calls
   * ``onRemoved``. */
  isAdded?: boolean
  /** Fired when the user explicitly clears the added flag. */
  onRemoved?: () => void
}

/**
 * Modal that lets the user pick where to add the event: Google, Outlook,
 * Yahoo, or Apple (via an .ics download). Each option opens the provider's
 * pre-filled compose URL in a new tab; Apple downloads the .ics since the
 * OS takes over from there.
 */
export function AddToCalendarModal({
  open,
  onOpenChange,
  eventId,
  event,
  onAdded,
  isAdded,
  onRemoved,
}: Props) {
  const { t } = useTranslation()
  const handleAdded = () => {
    onAdded?.()
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("events.add_to_calendar.title")}</DialogTitle>
          <DialogDescription>
            {t("events.add_to_calendar.description")}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-2">
          <ProviderButton
            href={googleCalendarUrl(event)}
            icon={<GoogleIcon />}
            label={t("events.add_to_calendar.google_calendar")}
            onClick={handleAdded}
          />
          <ProviderButton
            href={outlookCalendarUrl(event)}
            icon={<OutlookIcon />}
            label={t("events.add_to_calendar.outlook")}
            onClick={handleAdded}
          />
          <ProviderButton
            href={yahooCalendarUrl(event)}
            icon={<YahooIcon />}
            label={t("events.add_to_calendar.yahoo")}
            onClick={handleAdded}
          />
          <Button
            variant="outline"
            className="justify-start gap-3"
            onClick={() => {
              downloadEventIcs({ eventId, title: event.title })
              handleAdded()
              onOpenChange(false)
            }}
          >
            <AppleIcon />
            {t("events.add_to_calendar.apple_calendar")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="justify-start gap-3 text-muted-foreground"
            onClick={() => {
              downloadEventIcs({ eventId, title: event.title })
              handleAdded()
              onOpenChange(false)
            }}
          >
            <Download className="h-4 w-4" />
            {t("events.add_to_calendar.download_ics")}
          </Button>
          {isAdded && onRemoved && (
            <Button
              variant="ghost"
              size="sm"
              className="justify-start gap-3 text-destructive hover:text-destructive mt-1"
              onClick={() => {
                onRemoved()
                onOpenChange(false)
              }}
            >
              <X className="h-4 w-4" />
              {t("events.add_to_calendar.mark_removed")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ProviderButton({
  href,
  icon,
  label,
  onClick,
}: {
  href: string
  icon: ReactNode
  label: string
  onClick?: () => void
}) {
  return (
    <Button variant="outline" className="justify-start gap-3" asChild>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
      >
        {icon}
        {label}
      </a>
    </Button>
  )
}

// Minimal brand glyphs — we keep them inline to avoid adding an icon
// package, and draw them as simple SVG to match button height.

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.5 12.3c0-.7-.1-1.4-.2-2H12v3.8h5.9c-.3 1.4-1.1 2.6-2.3 3.4v2.8h3.7c2.2-2 3.2-5 3.2-8Z"
      />
      <path
        fill="#34A853"
        d="M12 23c3.1 0 5.7-1 7.6-2.7l-3.7-2.8c-1 .7-2.4 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v2.9C3.7 20.5 7.5 23 12 23Z"
      />
      <path
        fill="#FBBC04"
        d="M5.6 13.9c-.2-.7-.3-1.4-.3-2.2 0-.8.1-1.5.3-2.2V6.6H1.8C1 8 .5 9.9.5 11.7c0 1.8.4 3.7 1.3 5.1l3.8-2.9Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.7c1.7 0 3.2.6 4.4 1.7l3.3-3.3C17.6 1.2 15 0 12 0 7.5 0 3.7 2.5 1.8 6.6l3.8 2.9C6.5 6.7 9 4.7 12 4.7Z"
      />
    </svg>
  )
}

function OutlookIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#0078D4"
        d="M13 4v16l9-2.25V6.25L13 4Zm-2 2H3.5A1.5 1.5 0 0 0 2 7.5v9A1.5 1.5 0 0 0 3.5 18H11V6Zm-4 3.75c1.65 0 3 1.46 3 3.25s-1.35 3.25-3 3.25-3-1.46-3-3.25S5.35 9.75 7 9.75Z"
      />
    </svg>
  )
}

function YahooIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="#6001D2"
        d="M6 5h3.5l2.5 5.8L14.5 5H18l-5 10.5V20h-3v-4.5L5 5Zm12 9.3a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6Z"
      />
    </svg>
  )
}

function AppleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path
        fill="currentColor"
        d="M17 13.3c0-2.4 2-3.6 2.1-3.6-1.1-1.7-2.9-1.9-3.5-1.9-1.5-.2-2.9.9-3.6.9s-1.9-.9-3.1-.8c-1.6 0-3.1.9-3.9 2.4-1.7 2.9-.4 7.2 1.2 9.6.8 1.2 1.8 2.5 3.1 2.4 1.3 0 1.7-.8 3.2-.8s1.9.8 3.2.8c1.3 0 2.2-1.2 3-2.4.5-.7.9-1.5 1.2-2.4-3-.9-3-3.8-2.9-3.7ZM14.5 6.1c.7-.8 1.2-2 1-3.1-1 .1-2.2.7-2.9 1.6-.6.7-1.2 1.9-1 3 1.1 0 2.2-.6 2.9-1.5Z"
      />
    </svg>
  )
}
