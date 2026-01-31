import { useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import {
  CheckCircle,
  Clock,
  CreditCard,
  DollarSign,
  FileText,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react"

import { DashboardService } from "@/client"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout/")({
  component: Dashboard,
  head: () => ({
    meta: [
      {
        title: "Dashboard - EdgeOS",
      },
    ],
  }),
})

function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  href,
  isLoading,
  variant = "default",
}: {
  title: string
  value: number | string | undefined
  subtitle?: string
  icon: React.ComponentType<{ className?: string }>
  href?: string
  isLoading: boolean
  variant?: "default" | "success" | "warning" | "danger"
}) {
  const variantStyles = {
    default: "text-muted-foreground",
    success: "text-green-500",
    warning: "text-yellow-500",
    danger: "text-red-500",
  }

  const content = (
    <Card
      className={`transition-colors ${href ? "hover:bg-muted/50 cursor-pointer" : ""}`}
    >
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        <Icon className={`h-4 w-4 ${variantStyles[variant]}`} />
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <>
            <div className="text-2xl font-bold">{value ?? 0}</div>
            {subtitle && (
              <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )

  if (href) {
    return <Link to={href}>{content}</Link>
  }
  return content
}

function formatCurrency(value: string | undefined): string {
  if (!value) return "$0.00"
  const num = parseFloat(value)
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(num)
}

function Dashboard() {
  const { user: currentUser, isAdmin, isSuperadmin } = useAuth()
  const { selectedPopupId, selectedTenantId, isContextReady } = useWorkspace()

  // Fetch dashboard stats from dedicated endpoint
  const {
    data: stats,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["dashboard", "stats", selectedPopupId, selectedTenantId],
    queryFn: () =>
      DashboardService.getDashboardStats({
        popupId: selectedPopupId!,
        xTenantId: isSuperadmin ? selectedTenantId : undefined,
      }),
    enabled: isContextReady && !!selectedPopupId,
  })

  const applications = stats?.applications
  const attendees = stats?.attendees
  const payments = stats?.payments

  return (
    <div className="flex flex-col gap-6">
      {!isContextReady && <WorkspaceAlert resource="dashboard data" />}

      {isError && (
        <div className="rounded-lg border border-destructive bg-destructive/10 p-4 text-destructive">
          Failed to load dashboard stats: {error?.message || "Unknown error"}
        </div>
      )}

      {/* Welcome header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight truncate max-w-md">
            Welcome back, {currentUser?.full_name || currentUser?.email}
          </h1>
          <p className="text-muted-foreground">
            Registration statistics overview
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Applications"
          value={applications?.total}
          subtitle={`${applications?.accepted ?? 0} accepted`}
          icon={FileText}
          href="/applications"
          isLoading={isLoading}
        />
        <StatCard
          title="Total Attendees"
          value={attendees?.total}
          subtitle={`${attendees?.main ?? 0} main, ${attendees?.spouse ?? 0} spouse, ${attendees?.kid ?? 0} kids`}
          icon={Users}
          href="/attendees"
          isLoading={isLoading}
        />
        <StatCard
          title="Total Payments"
          value={payments?.total}
          subtitle={`${payments?.approved ?? 0} approved`}
          icon={CreditCard}
          href="/payments"
          isLoading={isLoading}
        />
        <StatCard
          title="Total Revenue"
          value={formatCurrency(payments?.approved_revenue)}
          subtitle={`${formatCurrency(payments?.pending_revenue)} pending`}
          icon={DollarSign}
          isLoading={isLoading}
          variant="success"
        />
      </div>

      {/* Detailed Breakdowns */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Application Status Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Applications by Status
            </CardTitle>
            <CardDescription>Current application pipeline</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-yellow-500" />
                    <span className="text-sm">In Review</span>
                  </div>
                  <span className="text-sm font-bold">
                    {applications?.in_review ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500" />
                    <span className="text-sm">Accepted</span>
                  </div>
                  <span className="text-sm font-bold text-green-600">
                    {applications?.accepted ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-red-500" />
                    <span className="text-sm">Rejected</span>
                  </div>
                  <span className="text-sm font-bold text-red-600">
                    {applications?.rejected ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Draft</span>
                  </div>
                  <span className="text-sm font-bold">
                    {applications?.draft ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">Withdrawn</span>
                  </div>
                  <span className="text-sm font-bold">
                    {applications?.withdrawn ?? 0}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Attendee Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Attendees by Category
            </CardTitle>
            <CardDescription>Registration breakdown</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                  <span className="text-sm">Main Attendees</span>
                  <span className="text-sm font-bold">
                    {attendees?.main ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                  <span className="text-sm">Spouses</span>
                  <span className="text-sm font-bold">
                    {attendees?.spouse ?? 0}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                  <span className="text-sm">Kids</span>
                  <span className="text-sm font-bold">
                    {attendees?.kid ?? 0}
                  </span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment Status & Revenue */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Payment Overview
            </CardTitle>
            <CardDescription>Revenue and payment status</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-8 w-full" />
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between p-2 rounded-md bg-green-500/10">
                  <span className="text-sm">Approved Revenue</span>
                  <span className="text-sm font-bold text-green-600">
                    {formatCurrency(payments?.approved_revenue)}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-md bg-yellow-500/10">
                  <span className="text-sm">Pending Revenue</span>
                  <span className="text-sm font-bold text-yellow-600">
                    {formatCurrency(payments?.pending_revenue)}
                  </span>
                </div>
                <div className="flex items-center justify-between p-2 rounded-md bg-muted/50">
                  <span className="text-sm">Total Discounts</span>
                  <span className="text-sm font-bold">
                    {formatCurrency(payments?.total_discounts)}
                  </span>
                </div>
                <div className="pt-2 border-t">
                  <div className="grid grid-cols-4 gap-2 text-center">
                    <div>
                      <div className="text-lg font-bold">
                        {payments?.approved ?? 0}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Approved
                      </div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-yellow-600">
                        {payments?.pending ?? 0}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Pending
                      </div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-red-600">
                        {payments?.rejected ?? 0}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Rejected
                      </div>
                    </div>
                    <div>
                      <div className="text-lg font-bold text-muted-foreground">
                        {(payments?.expired ?? 0) + (payments?.cancelled ?? 0)}
                      </div>
                      <div className="text-xs text-muted-foreground">Other</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions for Admins */}
      {isAdmin && (
        <div>
          <h2 className="text-lg font-semibold mb-4">Quick Actions</h2>
          <div className="flex flex-wrap gap-2">
            <Link
              to="/applications"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              <FileText className="h-4 w-4" />
              Review Applications
            </Link>
            <Link
              to="/attendees"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md border hover:bg-muted transition-colors"
            >
              <Users className="h-4 w-4" />
              View Attendees
            </Link>
            <Link
              to="/payments"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-md border hover:bg-muted transition-colors"
            >
              <CreditCard className="h-4 w-4" />
              Manage Payments
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
