"use client"

import {
  Clock,
  FileX,
  QrCode,
  Ticket,
  User,
  Users,
  XCircle,
} from "lucide-react"
import { useState } from "react"
import QRcode from "@/app/portal/[popupSlug]/passes/components/common/QRcode"
import type { CompanionParticipation } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useMyTicketsQuery } from "@/hooks/useMyTicketsQuery"
import { cn } from "@/lib/utils"
import { useCityProvider } from "@/providers/cityProvider"

const statusConfig: Record<
  string,
  { label: string; description: string; className: string; icon: typeof Clock }
> = {
  draft: {
    label: "Draft",
    description: "The application has not been submitted yet.",
    className: "bg-muted/50 text-muted-foreground",
    icon: FileX,
  },
  "in review": {
    label: "In Review",
    description:
      "Your application is being reviewed. You'll be notified once a decision is made.",
    className:
      "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
    icon: Clock,
  },
  rejected: {
    label: "Rejected",
    description: "The application was not accepted.",
    className: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
    icon: XCircle,
  },
  withdrawn: {
    label: "Withdrawn",
    description: "The application has been withdrawn.",
    className: "bg-muted/50 text-muted-foreground",
    icon: XCircle,
  },
}

const categoryLabels: Record<string, string> = {
  spouse: "Spouse",
  kid: "Kid",
  baby: "Baby",
  teen: "Teen",
  main: "Primary",
}

interface CompanionViewProps {
  participation: CompanionParticipation
}

export function CompanionView({ participation }: CompanionViewProps) {
  const { attendee, application_status } = participation
  const [isQrModalOpen, setIsQrModalOpen] = useState(false)
  const { getCity } = useCityProvider()
  const city = getCity()

  const { data: allTickets = [] } = useMyTicketsQuery()

  // Filter tickets for this companion attendee
  const myTicketEntry = allTickets.find((t) => t.id === attendee.id)
  const tickets = myTicketEntry?.products ?? []

  const isAccepted = application_status === "accepted"
  const hasTickets = tickets.length > 0
  // QR code is only safe to show when application is accepted AND companion has passes
  const canShowCheckIn = isAccepted && hasTickets && !!attendee.check_in_code

  const status = statusConfig[application_status]

  return (
    <Card className="w-full">
      <CardHeader className="pb-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <Users className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1">
            <CardTitle className="text-lg">
              You&apos;re attending as a companion
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {city?.name ? `for ${city.name}` : ""}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-6">
        {/* Application Status Banner (non-accepted states) */}
        {!isAccepted && status && (
          <div
            className={cn(
              "flex items-start gap-3 rounded-lg p-4",
              status.className,
            )}
          >
            <status.icon className="h-5 w-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <p className="font-medium text-sm">{status.label}</p>
              <p className="text-sm mt-0.5 opacity-80">{status.description}</p>
            </div>
          </div>
        )}

        {/* Attendee Info */}
        <div className="flex items-center gap-3 rounded-lg bg-muted/50 p-4">
          <User className="h-5 w-5 text-muted-foreground flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">{attendee.name}</p>
          </div>
          <Badge variant="secondary">
            {categoryLabels[attendee.category] ?? attendee.category}
          </Badge>
        </div>

        {/* Tickets — only show when accepted */}
        {isAccepted && (
          <div>
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
                          {new Date(ticket.end_date).toLocaleDateString(
                            "en-US",
                            {
                              month: "short",
                              day: "numeric",
                            },
                          )}
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
          </div>
        )}

        {/* Check-in Code — only when accepted AND has tickets */}
        {canShowCheckIn && (
          <div className="border-t pt-4">
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
      </CardContent>

      {canShowCheckIn && (
        <QRcode
          check_in_code={attendee.check_in_code!}
          isOpen={isQrModalOpen}
          onOpenChange={setIsQrModalOpen}
        />
      )}
    </Card>
  )
}

export default CompanionView
