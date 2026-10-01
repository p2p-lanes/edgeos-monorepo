"use client"

import { useQuery } from "@tanstack/react-query"
import { Check, Clipboard, Download, QrCode } from "lucide-react"
import { useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import QRCode from "react-qr-code"
import { EventsService } from "@/client"
import { Button } from "@/components/ui/button"
import { downloadQrPng } from "@/lib/qr-download"

/**
 * The QR an organizer shows so attendees can check themselves into an event.
 *
 * Whether this renders at all is the backend's call: the link endpoint 403s
 * for anyone who isn't the event's owner, assigned host or a collaborator,
 * and `retry: false` keeps that expected 403 from being retried. A plain
 * attendee never reaches `isSuccess`, so the panel simply isn't there — the
 * permission is enforced server-side, not hidden in the markup.
 *
 * Distinct from the gathering's ticket self check-in QR: that one says the
 * person arrived at the popup, this one that they attended this event.
 */
export function EventCheckInQr({
  eventId,
  occurrenceStart,
  canManage,
}: {
  eventId: string
  occurrenceStart?: string | null
  canManage: boolean
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const qrRef = useRef<HTMLDivElement>(null)

  const { data, isSuccess } = useQuery({
    queryKey: ["portal-event-check-in-link", eventId, occurrenceStart ?? null],
    queryFn: () =>
      EventsService.getPortalEventCheckInLink({
        eventId,
        occurrenceStart: occurrenceStart ?? undefined,
      }),
    enabled: !!eventId && canManage,
    retry: false,
  })

  if (!isSuccess || !data?.url) return null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(data.url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be denied (insecure context, permission prompt). The
      // URL is still on screen and selectable, so there's nothing to report.
    }
  }

  const handleDownload = () => {
    downloadQrPng(qrRef.current, `event-check-in-${eventId}.png`).catch(() => {
      // Nothing actionable for the organizer: the QR is on screen and can
      // be shown or screenshotted as-is.
    })
  }

  return (
    <div className="rounded-xl border bg-card p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <QrCode className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">
            {t("events.check_in.qr_heading")}
          </h3>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {t("events.check_in.qr_help")}
        </p>
      </div>

      {/* One line, ellipsised. The QR is what attendees use; the URL is only
          here to be copied elsewhere, so it costs the card nothing to keep
          it to a single row. The full value stays reachable through the
          tooltip and the copy button. */}
      <div className="flex items-center gap-1 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
        <span
          title={data.url}
          className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground"
        >
          {data.url}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          onClick={handleCopy}
          title={
            copied
              ? (t("events.check_in.url_copied") as string)
              : (t("events.check_in.copy_url") as string)
          }
          aria-label={t("events.check_in.copy_url") as string}
        >
          {copied ? (
            <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          ) : (
            <Clipboard className="h-4 w-4" />
          )}
        </Button>
      </div>

      <div className="flex flex-col items-center gap-3">
        {/* White plate in both themes: a dark-on-dark QR won't scan. */}
        <div ref={qrRef} className="rounded-xl border bg-white p-4 shadow-sm">
          <QRCode value={data.url} size={176} level="M" />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleDownload}
          className="inline-flex items-center gap-2"
        >
          <Download className="h-4 w-4" />
          {t("events.check_in.download_qr")}
        </Button>
      </div>
    </div>
  )
}
