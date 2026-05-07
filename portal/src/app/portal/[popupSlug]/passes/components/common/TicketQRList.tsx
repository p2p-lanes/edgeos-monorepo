import { QrCode } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { AttendeeProductPublic } from "@/client"
import QRcode from "./QRcode"

/**
 * Ticket entry enriched with product display data.
 * Combines AttendeeProductPublic with a denormalized product_name and requires_check_in
 * so the component does not need to do a join.
 */
export type TicketEntry = AttendeeProductPublic & {
  product_name?: string
  requires_check_in?: boolean
}

interface TicketQRListProps {
  tickets: TicketEntry[]
}

/**
 * Renders a list of scannable tickets — one entry per ticket where
 * `requires_check_in === true`. Tickets with `requires_check_in` falsy/undefined
 * (merch, non-scannable products) are silently skipped.
 *
 * Each entry shows the product name and the raw check_in_code, plus a button
 * that opens a shared modal with the QR enlarged.
 */
const TicketQRList = ({ tickets }: TicketQRListProps) => {
  const { t } = useTranslation()
  const [activeCode, setActiveCode] = useState<string | null>(null)

  const scannable = tickets.filter((t) => t.requires_check_in === true)

  if (scannable.length === 0) return null

  return (
    <div className="flex flex-col gap-2 mt-3">
      {scannable.map((ticket) => (
        <div
          key={ticket.id}
          className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border bg-card"
        >
          <div className="flex flex-col min-w-0">
            {ticket.product_name && (
              <p className="text-xs font-medium text-pass-text uppercase tracking-wider truncate">
                {ticket.product_name}
              </p>
            )}
            <p className="text-sm font-mono text-pass-title truncate">
              {ticket.check_in_code}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setActiveCode(ticket.check_in_code)}
            className="flex items-center gap-1.5 text-xs font-medium text-pass-text uppercase tracking-wider hover:text-pass-title transition-colors cursor-pointer flex-shrink-0"
          >
            <span>{t("passes.check_in_code")}</span>
            <QrCode className="w-4 h-4" />
          </button>
        </div>
      ))}

      <QRcode
        check_in_code={activeCode ?? ""}
        isOpen={activeCode !== null}
        onOpenChange={(open) => {
          if (!open) setActiveCode(null)
        }}
      />
    </div>
  )
}

export default TicketQRList
