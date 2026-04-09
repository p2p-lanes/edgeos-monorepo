import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { AlertTriangle, ArrowRight, Clock, ListChecks } from "lucide-react"

import {
  type ApplicationPublic,
  ApplicationReviewsService,
  DashboardService,
  type PaymentPublic,
  PaymentsService,
} from "@/client"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import {
  ApplicationFunnelChart,
  CumulativeTrendsCharts,
  DistributionCharts,
  KeyMetricsCards,
  RevenueBreakdownCharts,
} from "@/components/Dashboard"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout/")({
  component: Dashboard,
  head: () => ({
    meta: [{ title: "Dashboard - EdgeOS" }],
  }),
})

function Dashboard() {
  const { user: currentUser, isAdmin, isSuperadmin } = useAuth()
  const { selectedPopupId, selectedTenantId, isContextReady } = useWorkspace()

  const {
    data: enriched,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["dashboard", "enriched", selectedPopupId, selectedTenantId],
    queryFn: () =>
      DashboardService.getEnrichedDashboard({
        popupId: selectedPopupId!,
        xTenantId: isSuperadmin ? selectedTenantId : undefined,
      }),
    enabled: isContextReady && !!selectedPopupId,
  })

  return (
    <div className="flex flex-col gap-6">
      {!isContextReady && <WorkspaceAlert resource="dashboard data" />}

      {isError && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          Failed to load dashboard: {error?.message || "Unknown error"}
        </div>
      )}

      {/* Welcome + Needs Attention */}
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Welcome back, {currentUser?.full_name || currentUser?.email}
          </h1>
          <p className="text-muted-foreground text-sm">
            Event performance overview
          </p>
        </div>

        {isContextReady && isAdmin && (
          <NeedsAttention
            inReview={enriched?.applications.in_review ?? 0}
            selectedPopupId={selectedPopupId}
            isSuperadmin={isSuperadmin}
            selectedTenantId={selectedTenantId}
          />
        )}
      </div>

      {/* Key Metrics */}
      <section>
        <SectionTitle>Key Metrics</SectionTitle>
        <KeyMetricsCards data={enriched?.key_metrics} isLoading={isLoading} />
      </section>

      {/* Cumulative Trends */}
      <section>
        <SectionTitle>Trends</SectionTitle>
        <CumulativeTrendsCharts
          data={enriched?.cumulative_trends}
          isLoading={isLoading}
          currency={enriched?.key_metrics?.currency}
        />
      </section>

      {/* Revenue Breakdown + Distribution */}
      <section>
        <SectionTitle>Revenue & Distribution</SectionTitle>
        <div className="flex flex-col gap-4">
          <RevenueBreakdownCharts
            data={enriched?.revenue_breakdown}
            isLoading={isLoading}
            currency={enriched?.key_metrics?.currency}
          />
          <DistributionCharts
            data={enriched?.distribution}
            isLoading={isLoading}
          />
        </div>
      </section>

      {/* Application Pipeline + Recent Activity — side by side */}
      <section className="grid gap-4 lg:grid-cols-2">
        <div>
          <SectionTitle>Pipeline</SectionTitle>
          <ApplicationFunnelChart
            data={enriched?.application_funnel}
            isLoading={isLoading}
          />
        </div>

        {isContextReady && isAdmin && selectedPopupId && (
          <div>
            <SectionTitle>Recent Activity</SectionTitle>
            <RecentActivity
              selectedPopupId={selectedPopupId}
              isSuperadmin={isSuperadmin}
              selectedTenantId={selectedTenantId}
            />
          </div>
        )}
      </section>
    </div>
  )
}

// --- Helper components ---

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold mb-2 tracking-tight text-muted-foreground uppercase">
      {children}
    </h2>
  )
}

function NeedsAttention({
  inReview,
  selectedPopupId,
  isSuperadmin,
  selectedTenantId,
}: {
  inReview: number
  selectedPopupId: string | null
  isSuperadmin: boolean
  selectedTenantId: string | null | undefined
}) {
  const { data: pendingReviews } = useQuery({
    queryKey: ["pending-reviews-count", selectedPopupId],
    queryFn: () =>
      ApplicationReviewsService.listPendingReviews({
        popupId: selectedPopupId || undefined,
        skip: 0,
        limit: 1,
        xTenantId: isSuperadmin ? selectedTenantId : undefined,
      }),
    enabled: !!selectedPopupId,
  })

  const myPendingCount = pendingReviews?.paging?.total ?? 0
  const items = [
    {
      show: myPendingCount > 0,
      icon: ListChecks,
      label: `${myPendingCount} application${myPendingCount !== 1 ? "s" : ""} awaiting your review`,
      href: "/applications/review-queue",
      variant: "warning" as const,
    },
    {
      show: inReview > 0 && inReview !== myPendingCount,
      icon: Clock,
      label: `${inReview} application${inReview !== 1 ? "s" : ""} in review`,
      href: "/applications",
      variant: "default" as const,
    },
  ].filter((item) => item.show)

  if (items.length === 0) return null

  return (
    <div>
      <h2 className="text-sm font-semibold mb-2 flex items-center gap-2 text-yellow-600 dark:text-yellow-400">
        <AlertTriangle className="h-3.5 w-3.5" />
        Needs Attention
      </h2>
      <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Link key={item.href} to={item.href}>
            <Card className="transition-colors hover:bg-muted/50 cursor-pointer py-0">
              <CardContent className="flex items-center gap-3 p-3">
                <item.icon
                  className={`h-4 w-4 shrink-0 ${item.variant === "warning" ? "text-yellow-500" : "text-muted-foreground"}`}
                />
                <span className="text-sm font-medium flex-1">{item.label}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}

function timeAgo(dateStr: string): string {
  const now = Date.now()
  const then = new Date(dateStr).getTime()
  const diffMs = now - then
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return "just now"
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 30) return `${diffDay}d ago`
  return new Date(dateStr).toLocaleDateString()
}

const EXCLUDED_STATUSES = new Set(["expired", "cancelled"])

function RecentActivity({
  selectedPopupId,
  isSuperadmin,
  selectedTenantId,
}: {
  selectedPopupId: string
  isSuperadmin: boolean
  selectedTenantId: string | null | undefined
}) {
  const tenantHeader = isSuperadmin ? selectedTenantId : undefined

  const { data: recentApps, isLoading: appsLoading } = useQuery({
    queryKey: ["recent-applications", selectedPopupId],
    queryFn: () =>
      ApplicationReviewsService.listPendingReviews({
        popupId: selectedPopupId,
        skip: 0,
        limit: 5,
        xTenantId: tenantHeader,
      }),
  })

  // Fetch only approved + pending payments (the ones that matter)
  const { data: recentPayments, isLoading: paymentsLoading } = useQuery({
    queryKey: ["recent-payments-approved", selectedPopupId],
    queryFn: () =>
      PaymentsService.listPayments({
        popupId: selectedPopupId,
        paymentStatus: "approved",
        skip: 0,
        limit: 5,
        xTenantId: tenantHeader,
      }),
  })

  const apps = (recentApps?.results ?? []) as unknown as ApplicationPublic[]
  // Filter out expired/cancelled and $0 payments
  const payments = ((recentPayments?.results ?? []) as PaymentPublic[]).filter(
    (p) => !EXCLUDED_STATUSES.has(p.status ?? "") && Number(p.amount ?? 0) > 0,
  )
  const isLoading = appsLoading || paymentsLoading

  if (!isLoading && apps.length === 0 && payments.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center h-[220px] text-muted-foreground text-sm">
          No recent activity
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="h-fit">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Latest Activity</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton
                key={`activity-skeleton-${i.toString()}`}
                className="h-12 w-full"
              />
            ))}
          </div>
        ) : (
          <>
            {apps.map((app) => (
              <Link
                key={app.id}
                to="/applications/$id"
                params={{ id: app.id }}
                className="flex items-center justify-between rounded-md border p-2.5 hover:bg-muted/50 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">
                    {app.human?.first_name} {app.human?.last_name}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {app.human?.email}
                  </p>
                </div>
                <StatusBadge status={app.status} className="ml-2 shrink-0" />
              </Link>
            ))}
            {payments.map((payment) => (
              <div
                key={payment.id}
                className="flex items-center justify-between rounded-md border p-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium font-mono">
                    ${payment.amount} {payment.currency}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {payment.source || "—"}
                    {payment.created_at && (
                      <> • {timeAgo(payment.created_at)}</>
                    )}
                  </p>
                </div>
                <StatusBadge
                  status={payment.status ?? ""}
                  className="ml-2 shrink-0"
                />
              </div>
            ))}
          </>
        )}
      </CardContent>
    </Card>
  )
}
