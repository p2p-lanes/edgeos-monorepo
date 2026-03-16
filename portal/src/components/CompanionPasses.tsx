"use client"

import { QrCode, Ticket, Users } from "lucide-react"
import { useState } from "react"
import QRcode from "@/app/portal/[popupSlug]/passes/components/common/QRcode"
import type { CompanionParticipation } from "@/client"
import { Badge } from "@/components/ui/badge"
import { useMyTicketsQuery } from "@/hooks/useMyTicketsQuery"
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
  const { attendee, application_status } = participation
  const [isQrModalOpen, setIsQrModalOpen] = useState(false)
  const { getCity } = useCityProvider()
  const city = getCity()

  const { data: allTickets = [] } = useMyTicketsQuery()

  const myTicketEntry = allTickets.find((t) => t.id === attendee.id)
  const tickets = myTicketEntry?.products ?? []

  const isAccepted = application_status === "accepted"
  const hasTickets = tickets.length > 0
  const canShowCheckIn = isAccepted && hasTickets && !!attendee.check_in_code

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
          {categoryLabels[attendee.category] ?? attendee.category}
        </Badge>
      </div>

      {/* Tickets */}
      {isAccepted && (
        <div className="rounded-xl bg-white p-5 shadow-sm border border-gray-200">
          <h3 className="text-sm font-medium text-muted-foreground mb-3">
            Your Passes
          </h3>
          {tickets.length > 0 ? (
            <div className="space-y-2">
              {tickets.map((ticket, idx) => (
                <div
                  key={`${ticket.name}-${idx}`}
                  className={cn(
                    "flex items-center gap-3 py-3 px-4 rounded-lg bg-muted/30",
                  )}
                >
                  <Ticket className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <div className="flex items-baseline gap-2 flex-1 min-w-0">
                    <span className="font-medium text-sm">{ticket.name}</span>
                    {ticket.start_date && ticket.end_date && (
                      <span className="text-xs text-muted-foreground truncate">
                        {new Date(ticket.start_date).toLocaleDateString(
                          "en-US",
                          { month: "short", day: "numeric" },
                        )}{" "}
                        to{" "}
                        {new Date(ticket.end_date).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    )}
                  </div>
                  {ticket.quantity && ticket.quantity > 1 && (
                    <span className="text-xs text-muted-foreground">
                      x{ticket.quantity}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No passes assigned yet. Check back later.
            </p>
          )}

          {/* Check-in Code */}
          {canShowCheckIn && (
            <div className="border-t mt-4 pt-4">
              <button
                type="button"
                onClick={() => setIsQrModalOpen(true)}
                className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
              >
                <QrCode className="h-4 w-4" />
                <span>View Check-in Code</span>
              </button>
            </div>
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

      {canShowCheckIn && (
        <QRcode
          check_in_code={attendee.check_in_code!}
          isOpen={isQrModalOpen}
          onOpenChange={setIsQrModalOpen}
        />
      )}
    </div>
  )
}

export default CompanionPasses
