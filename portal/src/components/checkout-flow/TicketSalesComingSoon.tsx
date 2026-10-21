"use client"

import { Clock } from "lucide-react"
import Link from "next/link"
import { useTranslation } from "react-i18next"

interface TicketSalesComingSoonProps {
  /** The organiser's own heading; empty falls back to the translated default. */
  title?: string | null
  /** The organiser's own message; empty falls back to the translated default. */
  message?: string | null
  /** Where "back" goes, when the screen sits inside the portal. */
  backHref?: string
  backLabel?: string
}

/**
 * What a buyer sees instead of a checkout while the flow's ticket sales are
 * held as "coming soon" (`ticket_sales_status`). The backend refuses every
 * purchase in that state too; this screen is what keeps the buyer from
 * reaching that refusal.
 */
export function TicketSalesComingSoon({
  title,
  message,
  backHref,
  backLabel,
}: TicketSalesComingSoonProps) {
  const { t } = useTranslation()
  const heading = title?.trim() || t("ticketSales.coming_soon_title")
  const body = message?.trim() || t("ticketSales.coming_soon_description")

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <section
        aria-labelledby="ticket-sales-coming-soon-title"
        className="w-full max-w-lg rounded-2xl border bg-card p-8 text-center text-card-foreground shadow-sm"
      >
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Clock className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1
          id="ticket-sales-coming-soon-title"
          className="text-2xl font-semibold"
        >
          {heading}
        </h1>
        <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">
          {body}
        </p>
        {backHref && (
          <Link
            href={backHref}
            className="mt-6 inline-flex text-sm font-medium text-primary hover:underline"
          >
            {backLabel ?? t("shop.back_to_passes")}
          </Link>
        )}
      </section>
    </div>
  )
}
