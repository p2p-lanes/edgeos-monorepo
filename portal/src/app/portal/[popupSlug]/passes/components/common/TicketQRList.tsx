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
 * Renders a row of QR-icon buttons — one per ticket where
 * `requires_check_in === true`. Tickets with `requires_check_in` falsy/undefined
 * (merch, non-scannable products) are silently skipped.
 *
 * Visually minimal (matches the pre-refactor UX): each scannable ticket is
 * just a QR icon that opens the shared modal with the enlarged QR.
 */
const TicketQRList = ({ tickets }: TicketQRListProps) => {
  const { t } = useTranslation()
  const [activeCode, setActiveCode] = useState<string | null>(null)

  const scannable = tickets.filter((t) => t.requires_check_in === true)

  if (scannable.length === 0) return null

  return (
    <div className="flex items-center gap-2 mt-3 justify-end lg:absolute lg:bottom-6 lg:right-6 lg:mt-0">
      {scannable.map((ticket) => (
        <button
          key={ticket.id}
          type="button"
          onClick={() => setActiveCode(ticket.check_in_code)}
          aria-label={t("passes.check_in_code")}
          className="text-pass-text hover:text-pass-title transition-colors cursor-pointer"
        >
          <QrCode className="w-5 h-5" />
        </button>
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
