"use client"

import { Clock, FileX, QrCode, User, Users, XCircle } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import QRcode from "@/app/portal/[popupSlug]/passes/components/common/QRcode"
import {
  compareByCategory,
  getCategoryIcon,
} from "@/app/portal/[popupSlug]/passes/utils/categoryDisplay"
import type { CompanionParticipation } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  const { t } = useTranslation()
  const { attendee, application_status } = participation
  const { getCity } = useCityProvider()
  const city = getCity()

  // Per-ticket QR modal state — same pattern as AttendeeTicket (main applicant).
  // Drives the shared <QRcode> at the bottom so a single modal handles every QR.
  const [activeTicket, setActiveTicket] = useState<{
    code: string
    lastScanAt: string | null
  } | null>(null)

  const isAccepted = application_status === "accepted"
  const tickets = [...(attendee.tickets ?? [])]
    .filter((t) => t.product_category !== "patreon")
    .sort(compareByCategory)
  const hasTickets = tickets.length > 0

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
            {(attendee.category ? categoryLabels[attendee.category] : null) ??
              attendee.category}
          </Badge>
        </div>

        {/* Tickets — only show when accepted */}
        {isAccepted && (
          <div>
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
      </CardContent>

      <QRcode
        check_in_code={activeTicket?.code ?? ""}
        lastScanAt={activeTicket?.lastScanAt ?? null}
        isOpen={activeTicket !== null}
        onOpenChange={(open) => {
          if (!open) setActiveTicket(null)
        }}
      />
    </Card>
  )
}

export default CompanionView
