"use client"

import { QrCode, Ticket, Users } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import QRcode from "@/app/portal/[popupSlug]/passes/components/common/QRcode"
import {
  compareByCategory,
  getCategoryIcon,
} from "@/app/portal/[popupSlug]/passes/utils/categoryDisplay"
import type { CompanionParticipation } from "@/client"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { useCityProvider } from "@/providers/cityProvider"

const categoryLabels: Record<string, string> = {
  spouse: "Spouse",
  kid: "Kid",
  baby: "Baby",
  teen: "Teen",
  main: "Primary",
}

interface CompanionPassesProps {
  participation: CompanionParticipation
}

export function CompanionPasses({ participation }: CompanionPassesProps) {
  const { t } = useTranslation()
  const { attendee, application_status } = participation
  const { getCity } = useCityProvider()
  const city = getCity()

  // Per-ticket QR modal state — same pattern as AttendeeTicket (main applicant).
  const [activeTicket, setActiveTicket] = useState<{
    code: string
    lastScanAt: string | null
  } | null>(null)

  const isAccepted = application_status === "accepted"
  const tickets = [...(attendee.tickets ?? [])]
    .filter((t) => t.product_category !== "patreon")
    .sort(compareByCategory)
  const hasTickets = tickets.length > 0

  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      {/* Heading */}
      <div className="flex flex-col gap-2 max-w-3xl">
        <div className="flex items-center gap-3">
          <Ticket className="w-6 h-6 text-gray-700" />
          <h1 className="text-3xl font-bold tracking-tight">Your Passes</h1>
        </div>
        <p className="text-muted-foreground/75">
          You&apos;re attending {city?.name ? `${city.name} ` : ""}as a
          companion.
        </p>
      </div>

      {/* Attendee Info */}
      <div className="flex items-center gap-3 rounded-xl bg-white p-4 shadow-sm border border-gray-200">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
          <Users className="h-5 w-5 text-primary" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm">{attendee.name}</p>
        </div>
        <Badge variant="secondary">
          {(attendee.category ? categoryLabels[attendee.category] : null) ??
            attendee.category}
        </Badge>
      </div>

      {/* Tickets */}
      {isAccepted && (
        <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-200">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Your Passes
          </h3>
          {hasTickets ? (
            <div>
              {tickets.map((ticket, idx) => {
                const CategoryIcon = getCategoryIcon(ticket.product_category)
                const isScanned = ticket.last_scan_at != null
                return (
                  <div
                    key={ticket.id}
                    className={cn(
                      "flex items-center gap-3 py-3",
                      idx !== tickets.length - 1 &&
                        "border-b border-dotted border-border",
                    )}
                  >
                    <CategoryIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex items-baseline gap-2 flex-1 min-w-0">
                      <span className="font-medium text-sm">
                        {ticket.product_name ?? ticket.check_in_code}
                      </span>
                    </div>
                    {ticket.requires_check_in && (
                      <button
                        type="button"
                        onClick={() =>
                          setActiveTicket({
                            code: ticket.check_in_code,
                            lastScanAt: ticket.last_scan_at ?? null,
                          })
                        }
                        aria-label={
                          isScanned
                            ? t("passes.qr_already_scanned")
                            : t("passes.check_in_code")
                        }
                        className={cn(
                          "transition-colors cursor-pointer flex-shrink-0",
                          isScanned
                            ? "text-yellow-500 hover:text-yellow-700"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <QrCode className="h-5 w-5" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No passes assigned yet. Check back later.
            </p>
          )}
        </div>
      )}

      {!isAccepted && (
        <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-200">
          <p className="text-sm text-muted-foreground text-center">
            Passes will be available once the application is accepted.
          </p>
        </div>
      )}

      <QRcode
        check_in_code={activeTicket?.code ?? ""}
        lastScanAt={activeTicket?.lastScanAt ?? null}
        isOpen={activeTicket !== null}
        onOpenChange={(open) => {
          if (!open) setActiveTicket(null)
        }}
      />
    </div>
  )
}

export default CompanionPasses
