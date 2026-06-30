"use client"

import { Calendar, CalendarPlus, Check, Copy, Download } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { OpenAPI } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

/**
 * "Add to calendar" for the whole popup: subscribe (live feed) or download a
 * snapshot. The feed is the public ICS endpoint, served by popup_id so it
 * works without auth/Origin (calendar apps fetch it server-side). The same
 * feed URL is wrapped per platform — Apple via webcal://, Google via its
 * add-by-URL — unlike the per-event "add to calendar" which pre-fills one
 * event. Only published + public events are included.
 */
export function SubscribeCalendarButton({ popupId }: { popupId: string }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)

  const feedUrl = `${OpenAPI.BASE}/api/v1/events/public/calendar.ics?popup_id=${popupId}`
  const webcalUrl = feedUrl.replace(/^https?:\/\//, "webcal://")
  const googleUrl = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(
    webcalUrl,
  )}`

  const copyFeed = async () => {
    try {
      await navigator.clipboard.writeText(feedUrl)
      setCopied(true)
      toast.success(
        t("events.subscribe.copied", { defaultValue: "Feed URL copied" }),
      )
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(
        t("events.subscribe.copy_error", { defaultValue: "Couldn't copy" }),
      )
    }
  }

  const itemClass =
    "flex w-full items-center gap-2 rounded-md px-2 py-2 text-sm text-left hover:bg-muted"

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <CalendarPlus className="mr-2 h-4 w-4" />
          {t("events.subscribe.button", { defaultValue: "Add to calendar" })}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1">
        <p className="px-2 py-1.5 text-xs text-muted-foreground">
          {t("events.subscribe.help", {
            defaultValue:
              "Subscribe to keep all public events in sync, or download a snapshot.",
          })}
        </p>
        <a className={itemClass} href={webcalUrl}>
          <Calendar className="h-4 w-4 shrink-0" />
          {t("events.subscribe.apple", { defaultValue: "Apple Calendar" })}
        </a>
        <a
          className={itemClass}
          href={googleUrl}
          target="_blank"
          rel="noopener noreferrer"
        >
          <Calendar className="h-4 w-4 shrink-0" />
          {t("events.subscribe.google", { defaultValue: "Google Calendar" })}
        </a>
        <button type="button" className={itemClass} onClick={copyFeed}>
          {copied ? (
            <Check className="h-4 w-4 shrink-0" />
          ) : (
            <Copy className="h-4 w-4 shrink-0" />
          )}
          {t("events.subscribe.copy", { defaultValue: "Copy feed URL" })}
        </button>
        <a className={itemClass} href={feedUrl} download>
          <Download className="h-4 w-4 shrink-0" />
          {t("events.subscribe.download", { defaultValue: "Download .ics" })}
        </a>
      </PopoverContent>
    </Popover>
  )
}
