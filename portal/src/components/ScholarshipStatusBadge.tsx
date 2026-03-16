import type { ApplicationPublic, PopupPublic } from "@/client"

interface ScholarshipStatusBadgeProps {
  application: ApplicationPublic
  popup: PopupPublic
}

/**
 * Read-only scholarship status indicator.
 * Rendered only when:
 * - popup.allows_scholarship is true
 * - application.scholarship_request is true
 */
export function ScholarshipStatusBadge({
  application,
  popup,
}: ScholarshipStatusBadgeProps) {
  if (!popup.allows_scholarship) return null
  if (!application.scholarship_request) return null

  const status = application.scholarship_status ?? null

  if (status === "approved") {
    const discount = application.discount_percentage
      ? `${application.discount_percentage}% discount`
      : null
    const incentive =
      application.incentive_amount && application.incentive_currency
        ? `${application.incentive_currency} ${application.incentive_amount} grant`
        : null

    return (
      <div className="flex items-center gap-2 mt-2">
        <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm font-semibold bg-green-100 text-green-800">
          Scholarship: Approved ✓
        </span>
        {discount && (
          <span className="text-sm text-muted-foreground">{discount}</span>
        )}
        {incentive && (
          <span className="text-sm text-muted-foreground">{incentive}</span>
        )}
      </div>
    )
  }

  if (status === "rejected") {
    return (
      <div className="mt-2">
        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-red-100 text-red-800">
          Scholarship: Not approved
        </span>
      </div>
    )
  }

  // null / "pending" — show pending review
  return (
    <div className="mt-2">
      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-yellow-100 text-yellow-800">
        Scholarship: Pending review
      </span>
    </div>
  )
}
