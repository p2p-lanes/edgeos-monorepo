import QRCodeReact from "react-qr-code"
import type { AttendeeProductPublic } from "@/client"

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
 * Renders a vertical list of QR codes — one per ticket that has
 * `requires_check_in === true`. Tickets with `requires_check_in === false`
 * (merch, non-scannable products) are silently skipped.
 *
 * Layout: each entry shows the product name and a compact QR code +
 * the raw check_in_code string beneath it.
 */
const TicketQRList = ({ tickets }: TicketQRListProps) => {
  const scannable = tickets.filter((t) => t.requires_check_in !== false)

  if (scannable.length === 0) return null

  return (
    <div className="flex flex-col gap-4 mt-3">
      {scannable.map((ticket) => {
        const qrValue = JSON.stringify({ code: ticket.check_in_code })
        return (
          <div
            key={ticket.id}
            className="flex flex-col items-center gap-2 p-3 rounded-xl border border-border bg-card"
          >
            {ticket.product_name && (
              <p className="text-xs font-medium text-pass-text uppercase tracking-wider">
                {ticket.product_name}
              </p>
            )}
            <div className="bg-white p-2 rounded-md border border-border">
              <QRCodeReact value={qrValue} size={120} level="H" />
            </div>
            <p className="text-sm font-mono text-pass-title">
              {ticket.check_in_code}
            </p>
          </div>
        )
      })}
    </div>
  )
}

export default TicketQRList
