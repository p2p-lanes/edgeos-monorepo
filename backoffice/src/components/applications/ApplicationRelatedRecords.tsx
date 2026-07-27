import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { ChevronRight, CreditCard, User, Users } from "lucide-react"
import type { ReactNode } from "react"

import {
  type ApplicationPublic,
  type PaymentPublic,
  PaymentsService,
} from "@/client"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { HumanRatingBadge } from "@/components/Humans/HumanRatingBadge"
import { Button } from "@/components/ui/button"

export const RELATED_PAYMENTS_LIMIT = 3

function ResourceHeader({
  id,
  icon,
  title,
  count,
  action,
}: {
  id: string
  icon: ReactNode
  title: string
  count?: number
  action?: ReactNode
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 px-1">
      <h3
        id={id}
        className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground"
      >
        {icon}
        {title}
        {count !== undefined && (
          <span className="font-mono text-[11px] tabular-nums">{count}</span>
        )}
      </h3>
      {action}
    </div>
  )
}

const resourceActionClassName =
  "inline-flex items-center gap-0.5 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

function PaymentsRows({
  payments,
  isLoading,
  isError,
  onRetry,
}: {
  payments: PaymentPublic[]
  isLoading: boolean
  isError: boolean
  onRetry: () => void
}) {
  if (isLoading) {
    return (
      <tr className="border-t">
        <td colSpan={3} className="px-3 py-3 text-muted-foreground">
          Loading payments…
        </td>
      </tr>
    )
  }

  if (isError) {
    return (
      <tr className="border-t">
        <td colSpan={3} className="px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-muted-foreground">
              Unable to load payments.
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={onRetry}>
              Retry
            </Button>
          </div>
        </td>
      </tr>
    )
  }

  if (payments.length === 0) {
    return (
      <tr className="border-t">
        <td colSpan={3} className="px-3 py-3 text-muted-foreground">
          No payments associated with this application.
        </td>
      </tr>
    )
  }

  return payments.map((payment) => (
    <tr key={payment.id} className="border-t">
      <td className="hidden px-3 py-2.5 text-muted-foreground sm:table-cell">
        {payment.created_at
          ? new Date(payment.created_at).toLocaleDateString()
          : "—"}
      </td>
      <td className="px-3 py-2.5 font-mono tabular-nums">
        {Number(payment.amount ?? 0).toLocaleString(undefined, {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}{" "}
        {payment.currency ?? ""}
      </td>
      <td className="px-3 py-2.5 text-right">
        <StatusBadge status={payment.status ?? ""} />
      </td>
    </tr>
  ))
}

export function ApplicationRelatedRecords({
  application,
}: {
  application: ApplicationPublic
}) {
  const attendees = application.attendees ?? []
  const humanName =
    [application.human?.first_name, application.human?.last_name]
      .filter(Boolean)
      .join(" ") || "Unknown human"
  const initials =
    [application.human?.first_name, application.human?.last_name]
      .filter(Boolean)
      .map((part) => part?.charAt(0).toUpperCase())
      .join("") || "?"
  const humanMetadata = [
    application.human?.residence,
    application.human?.gender
      ? application.human.gender.charAt(0).toUpperCase() +
        application.human.gender.slice(1)
      : null,
    application.human?.age,
  ].filter(Boolean)

  const {
    data: paymentsData,
    isLoading: paymentsLoading,
    isError: paymentsError,
    refetch: refetchPayments,
  } = useQuery({
    queryKey: ["payments", "by-application", application.id, "preview"],
    queryFn: () =>
      PaymentsService.listPayments({
        applicationId: application.id,
        limit: RELATED_PAYMENTS_LIMIT,
      }),
  })
  const payments = (paymentsData?.results ?? []).slice(
    0,
    RELATED_PAYMENTS_LIMIT,
  )
  const paymentsTotal = paymentsData?.paging.total ?? payments.length
  const visibleAttendees = attendees.slice(0, 3)

  return (
    <section aria-labelledby="related-records-heading" className="space-y-5">
      <h2
        id="related-records-heading"
        className="text-sm font-semibold text-foreground"
      >
        Related records
      </h2>

      <section aria-labelledby="related-human-heading">
        <ResourceHeader
          id="related-human-heading"
          icon={<User className="size-3.5" />}
          title="Human"
          action={
            <Link
              to="/humans/$id"
              params={{ id: application.human_id }}
              className={resourceActionClassName}
            >
              Open profile
              <ChevronRight className="size-3.5" />
            </Link>
          }
        />
        <div className="flex items-start gap-3 rounded-md border bg-muted/20 p-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-background font-semibold text-muted-foreground ring-1 ring-border">
            {initials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium">{humanName}</p>
              <HumanRatingBadge
                rating={application.human?.rating}
                showUnrated
              />
            </div>
            {application.human?.email && (
              <p className="truncate text-sm text-muted-foreground">
                {application.human.email}
              </p>
            )}
            {humanMetadata.length > 0 && (
              <p className="mt-1 text-xs text-muted-foreground">
                {humanMetadata.join(" · ")}
              </p>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="related-payments-heading">
        <ResourceHeader
          id="related-payments-heading"
          icon={<CreditCard className="size-3.5" />}
          title="Payments"
          count={paymentsLoading || paymentsError ? undefined : paymentsTotal}
          action={
            paymentsTotal > 0 ? (
              <Link
                to="/payments"
                search={{ applicationId: application.id }}
                className={resourceActionClassName}
              >
                View payments
                <ChevronRight className="size-3.5" />
              </Link>
            ) : undefined
          }
        />
        <div className="overflow-hidden rounded-md border">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="hidden w-[34%] px-3 py-2 font-medium sm:table-cell">
                  Created
                </th>
                <th className="px-3 py-2 font-medium">Amount</th>
                <th className="w-24 px-3 py-2 text-right font-medium">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              <PaymentsRows
                payments={payments}
                isLoading={paymentsLoading}
                isError={paymentsError}
                onRetry={() => void refetchPayments()}
              />
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="related-attendees-heading">
        <ResourceHeader
          id="related-attendees-heading"
          icon={<Users className="size-3.5" />}
          title="Attendees"
          count={attendees.length}
          action={
            attendees.length > 0 ? (
              <Link
                to="/attendees"
                search={{ applicationId: application.id }}
                className={resourceActionClassName}
              >
                View all
                <ChevronRight className="size-3.5" />
              </Link>
            ) : undefined
          }
        />
        <div className="overflow-hidden rounded-md border">
          <table className="w-full table-fixed text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Attendee</th>
                <th className="hidden w-28 px-3 py-2 font-medium sm:table-cell">
                  Category
                </th>
                <th className="w-20 px-3 py-2 text-right font-medium">
                  Tickets
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleAttendees.length === 0 ? (
                <tr className="border-t">
                  <td colSpan={3} className="px-3 py-3 text-muted-foreground">
                    No attendees created for this application.
                  </td>
                </tr>
              ) : (
                visibleAttendees.map((attendee) => (
                  <tr key={attendee.id} className="border-t">
                    <td className="min-w-0 px-3 py-2.5">
                      <Link
                        to="/attendees/$attendeeId"
                        params={{ attendeeId: attendee.id }}
                        className="group inline-flex max-w-full items-center gap-1 font-medium hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="truncate">{attendee.name}</span>
                        <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </Link>
                      {attendee.category && (
                        <p className="mt-0.5 text-xs capitalize text-muted-foreground sm:hidden">
                          {attendee.category}
                        </p>
                      )}
                    </td>
                    <td className="hidden px-3 py-2.5 capitalize text-muted-foreground sm:table-cell">
                      {attendee.category ?? "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular-nums">
                      {attendee.products?.length ?? 0}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  )
}
