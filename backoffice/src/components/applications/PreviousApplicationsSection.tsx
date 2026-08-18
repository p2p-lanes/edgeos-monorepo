import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronRight, History } from "lucide-react"

import {
  ApplicationsService,
  type PreviousApplicationSpend,
  type PreviousApplicationSummary,
} from "@/client"
import { ResourceHeader } from "@/components/applications/ResourceHeader"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { Button } from "@/components/ui/button"

/** Popup start date as "Oct 2024" — enough to place the popup in time. */
function formatPopupDate(value: string | null | undefined): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" })
}

function formatAmount(amount: string): string {
  return Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Approved spend for one application. The backend groups by currency because
 * payments carry their own — a single popup can hold more than one, and the
 * totals must not be added together.
 */
function SpendCell({ spend }: { spend: PreviousApplicationSpend[] }) {
  const nonZero = spend.filter((entry) => Number(entry.amount) !== 0)

  if (nonZero.length === 0) {
    return <span className="text-muted-foreground">—</span>
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      {nonZero.map((entry) => (
        <span key={entry.currency} className="whitespace-nowrap">
          {formatAmount(entry.amount)}{" "}
          <span className="text-xs text-muted-foreground">
            {entry.currency}
          </span>
        </span>
      ))}
    </div>
  )
}

function PreviousApplicationsRows({
  applications,
  isLoading,
  isError,
  onRetry,
}: {
  applications: PreviousApplicationSummary[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}) {
  if (isLoading) {
    return (
      <tr className="border-t">
        <td colSpan={4} className="px-3 py-3 text-muted-foreground">
          Loading previous applications…
        </td>
      </tr>
    )
  }

  if (isError) {
    return (
      <tr className="border-t">
        <td colSpan={4} className="px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">
              Unable to load previous applications.
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </td>
      </tr>
    )
  }

  if (applications.length === 0) {
    return (
      <tr className="border-t">
        <td colSpan={4} className="px-3 py-3 text-muted-foreground">
          No previous applications in other popups.
        </td>
      </tr>
    )
  }

  return applications.map((application) => {
    const popupDate = formatPopupDate(application.popup_start_date)
    return (
      <tr key={application.id} className="border-t">
        <td className="min-w-0 px-3 py-2.5">
          <Link
            to="/applications/$id"
            params={{ id: application.id }}
            className="group inline-flex max-w-full items-center gap-1 font-medium hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <span className="truncate">
              {application.popup_name ?? "Unknown popup"}
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </Link>
          {popupDate && (
            <p className="mt-0.5 text-xs text-muted-foreground">{popupDate}</p>
          )}
        </td>
        <td className="px-3 py-2.5">
          <StatusBadge status={application.status} />
        </td>
        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
          {application.tickets_count ?? 0}
        </td>
        <td className="px-3 py-2.5 text-right font-mono tabular-nums">
          <SpendCell spend={application.spend ?? []} />
        </td>
      </tr>
    )
  })
}

/**
 * The applicant's history across the tenant's other popups: which ones they
 * applied to, how each one ended, how many tickets they bought and what they
 * paid. Rendered even when empty — "first time with us" is signal too.
 */
export function PreviousApplicationsSection({
  applicationId,
}: {
  applicationId: string
}) {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["applications", applicationId, "previous"],
    queryFn: () =>
      ApplicationsService.listPreviousApplications({ applicationId }),
  })

  const applications = data ?? []

  return (
    <section aria-labelledby="related-previous-applications-heading">
      <ResourceHeader
        id="related-previous-applications-heading"
        icon={<History className="size-3.5" />}
        title="Previous applications"
        count={isLoading || isError ? undefined : applications.length}
      />
      <div className="overflow-hidden rounded-md border">
        <table className="w-full table-fixed text-sm">
          <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 font-medium">Popup</th>
              <th className="w-28 px-3 py-2 font-medium">Status</th>
              <th className="w-20 px-3 py-2 text-right font-medium">Tickets</th>
              <th className="w-28 px-3 py-2 text-right font-medium">Spent</th>
            </tr>
          </thead>
          <tbody>
            <PreviousApplicationsRows
              applications={applications}
              isLoading={isLoading}
              isError={isError}
              onRetry={() => void refetch()}
            />
          </tbody>
        </table>
      </div>
    </section>
  )
}
