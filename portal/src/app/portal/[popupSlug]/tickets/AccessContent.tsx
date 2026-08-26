"use client"

import { CheckCircle2, Ticket, Users } from "lucide-react"
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

function TicketMetadata({
  ticket,
  unavailableLabel,
}: {
  ticket: ScannableAccessTicket
  unavailableLabel: string
}) {
  const metadata = [ticket.category, ticket.duration].filter(
    (value): value is string => Boolean(value),
  )

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      {metadata.length > 0 ? (
        metadata.map((value) => <span key={value}>{value}</span>)
      ) : (
        <span>{unavailableLabel}</span>
      )}
    </div>
  )
}

export function AccessContent({ access }: { access: ScannableAccessHolder[] }) {
  const { t } = useTranslation()
  const [activeTicket, setActiveTicket] =
    useState<ScannableAccessTicket | null>(null)

  return (
    <section
      className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6"
      aria-labelledby="tickets-access-title"
    >
      <div>
        <h1
          id="tickets-access-title"
          className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl"
        >
          {t("tickets_access.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("tickets_access.description")}
        </p>
      </div>

      {access.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-muted">
            <Ticket className="size-6 text-muted-foreground" />
          </div>
          <h2 className="mt-3 font-semibold">
            {t("tickets_access.empty_title")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("tickets_access.empty_description")}
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {access.map((holder) => (
            <section
              key={holder.holderId}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
              aria-label={holder.holderName}
            >
              <div className="flex items-center gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
                <span className="grid size-9 place-items-center rounded-full bg-background text-sm font-semibold text-muted-foreground">
                  {holder.holderName
                    .split(" ")
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((part) => part[0])
                    .join("")
                    .toUpperCase()}
                </span>
                <div>
                  <Users
                    className="mb-1 size-3 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <h2 className="font-semibold">{holder.holderName}</h2>
                </div>
              </div>
              <ul className="divide-y">
                {holder.tickets.map((ticket) => (
                  <li
                    key={ticket.id}
                    className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge
                          variant={ticket.lastScanAt ? "secondary" : "default"}
                        >
                          {ticket.lastScanAt
                            ? t("tickets_access.checked_in")
                            : t("tickets_access.active")}
                        </Badge>
                        <code className="rounded bg-muted px-2 py-1 text-xs text-muted-foreground">
                          {ticket.checkInCode}
                        </code>
                      </div>
                      <p className="mt-2 font-medium">{ticket.name}</p>
                      <TicketMetadata
                        ticket={ticket}
                        unavailableLabel={t(
                          "tickets_access.details_unavailable",
                        )}
                      />
                    </div>
                    <button
                      type="button"
                      className="grid shrink-0 self-start place-items-center rounded-lg border border-slate-200 bg-white p-1.5 text-muted-foreground shadow-sm transition-colors hover:bg-slate-50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:ml-auto sm:self-auto"
                      aria-label={t("tickets_access.show_code", {
                        ticket: ticket.name,
                      })}
                      onClick={() => {
                        trackPortalTelemetry("access_code_opened")
                        setActiveTicket(ticket)
                      }}
                    >
                      <QRCodeReact
                        aria-label={t("tickets_access.qr_alt")}
                        value={JSON.stringify({ code: ticket.checkInCode })}
                        size={56}
                        level="H"
                      />
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
