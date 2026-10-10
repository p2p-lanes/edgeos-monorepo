"use client"

import { QrCode, Ticket } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { PersonalTicketsPublic } from "@/client"
import { Button } from "@/components/ui/button"
import QRcode from "./common/QRcode"

/** Read-only cards: email matching does not authorize attendee edits or checkout. */
export function PersonalTicketPasses({
  attendees,
}: {
  attendees: PersonalTicketsPublic[]
}) {
  const { t } = useTranslation()
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null)
  const activeTicket = attendees
    .flatMap((attendee) => attendee.tickets ?? [])
    .find((ticket) => ticket.id === activeTicketId)

  if (attendees.length === 0) return null

  return (
    <section className="space-y-4" aria-label={t("passes.assigned_tickets")}>
      <div>
        <h2 className="text-lg font-semibold text-pass-title">
          {t("passes.assigned_tickets")}
        </h2>
        <p className="mt-1 text-sm text-pass-text">
          {t("passes.assigned_tickets_description")}
        </p>
      </div>
      {attendees.map((attendee) => (
        <div
          key={attendee.id}
          className="overflow-hidden rounded-3xl border border-border bg-card lg:grid lg:grid-cols-[1fr_2fr]"
        >
          <div className="border-b border-dashed border-border p-6 lg:border-r lg:border-b-0">
            <h3 className="text-xl font-bold text-pass-title">
              {attendee.popup_name}
            </h3>
            <p className="mt-2 text-sm text-pass-text">{attendee.name}</p>
            {attendee.category && (
              <p className="mt-1 text-sm text-muted-foreground">
                {attendee.category}
              </p>
            )}
          </div>
          <ul className="divide-y divide-dotted divide-border px-6 py-3">
            {(attendee.tickets ?? []).length > 0
              ? attendee.tickets?.map((ticket) => (
                  <li key={ticket.id} className="flex items-center gap-3 py-3">
                    <Ticket className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 text-sm font-medium text-pass-text">
                      {ticket.product_name ?? ticket.check_in_code}
                    </span>
                    {ticket.requires_check_in && ticket.check_in_code && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={
                          ticket.last_scan_at
                            ? t("passes.qr_already_scanned")
                            : t("passes.check_in_code")
                        }
                        onClick={() => setActiveTicketId(ticket.id)}
                      >
                        <QrCode
                          className={
                            ticket.last_scan_at ? "text-yellow-600" : ""
                          }
                        />
                      </Button>
                    )}
                  </li>
                ))
              : attendee.products.map((product, index) => (
                  <li
                    key={`${product.name}-${index}`}
                    className="flex items-center gap-3 py-3 text-sm text-pass-text"
                  >
                    <Ticket className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 font-medium">
                      {product.name}
                    </span>
                    <span>×{product.quantity}</span>
                  </li>
                ))}
          </ul>
        </div>
      ))}
      <QRcode
        check_in_code={activeTicket?.check_in_code ?? ""}
        lastScanAt={activeTicket?.last_scan_at ?? null}
        isOpen={activeTicket != null}
        onOpenChange={(open) => {
          if (!open) setActiveTicketId(null)
        }}
      />
    </section>
  )
}
