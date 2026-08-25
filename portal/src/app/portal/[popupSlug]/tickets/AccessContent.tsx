"use client"

import { CheckCircle2, QrCode, Ticket, Users } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import QRCodeReact from "react-qr-code"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { trackPortalTelemetry } from "@/lib/portal-telemetry"
import type {
  ScannableAccessHolder,
  ScannableAccessTicket,
} from "./accessProjection"

export function AccessContent({ access }: { access: ScannableAccessHolder[] }) {
  const { t } = useTranslation()
  const [activeTicket, setActiveTicket] =
    useState<ScannableAccessTicket | null>(null)

  return (
    <section
      className="mx-auto max-w-3xl space-y-6 p-6"
      aria-labelledby="tickets-access-title"
    >
      <div>
        <h1 id="tickets-access-title" className="text-2xl font-semibold">
          {t("tickets_access.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("tickets_access.description")}
        </p>
      </div>

      {access.length === 0 ? (
        <div className="rounded-2xl border bg-card p-8 text-center">
          <Ticket className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-3 font-semibold">
            {t("tickets_access.empty_title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("tickets_access.empty_description")}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {access.map((holder) => (
            <section
              key={holder.holderId}
              className="rounded-2xl border bg-card p-5"
              aria-label={holder.holderName}
            >
              <div className="flex items-center gap-2">
                <Users className="size-4 text-muted-foreground" />
                <h2 className="font-medium">{holder.holderName}</h2>
              </div>
              <ul className="mt-4 divide-y rounded-lg border">
                {holder.tickets.map((ticket) => (
                  <li
                    key={ticket.id}
                    className="flex items-center justify-between gap-4 p-3"
                  >
                    <div>
                      <p className="font-medium">{ticket.name}</p>
                      <Badge
                        className="mt-2"
                        variant={ticket.lastScanAt ? "secondary" : "outline"}
                      >
                        {ticket.lastScanAt
                          ? t("tickets_access.checked_in")
                          : t("tickets_access.active")}
                      </Badge>
                    </div>
                    <button
                      type="button"
                      className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label={t("tickets_access.show_code", {
                        ticket: ticket.name,
                      })}
                      onClick={() => {
                        trackPortalTelemetry("access_code_opened")
                        setActiveTicket(ticket)
                      }}
                    >
                      <QrCode className="size-5" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Dialog
        open={activeTicket !== null}
        onOpenChange={(open) => {
          if (!open) setActiveTicket(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("tickets_access.code_title")}</DialogTitle>
            <DialogDescription>
              {t("tickets_access.code_description")}
            </DialogDescription>
          </DialogHeader>
          {activeTicket && (
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="rounded-md border bg-white p-4">
                <QRCodeReact
                  aria-label={t("tickets_access.qr_alt")}
                  value={JSON.stringify({ code: activeTicket.checkInCode })}
                  size={200}
                  level="H"
                />
              </div>
              <p className="font-mono text-lg">{activeTicket.checkInCode}</p>
              {activeTicket.lastScanAt && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <CheckCircle2 className="size-4" />
                  {t("tickets_access.checked_in")}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
