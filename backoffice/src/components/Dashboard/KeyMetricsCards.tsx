import {
  BedDouble,
  DollarSign,
  Percent,
  Receipt,
  TrendingUp,
  Users,
} from "lucide-react"
import type { KeyMetrics } from "@/client"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"

function formatCurrency(
  value: number | string | undefined,
  currency: string = "USD",
): string {
  const num =
    typeof value === "string" ? Number.parseFloat(value) : (value ?? 0)
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(num)
}

function formatCompact(
  value: number | string | undefined,
  currency: string = "USD",
): string {
  const num =
    typeof value === "string" ? Number.parseFloat(value) : (value ?? 0)
  if (num >= 1_000_000) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(num)
  }
  return formatCurrency(num, currency)
}

type MetricCardProps = {
  title: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  description?: string
  accentClass?: string
}

function MetricCard({
  title,
  value,
  icon: Icon,
  description,
  accentClass = "text-muted-foreground",
}: MetricCardProps) {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between">
          <CardDescription className="text-xs font-medium uppercase tracking-wide">
            {title}
          </CardDescription>
          <Icon className={`h-4 w-4 ${accentClass}`} />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <CardTitle className="text-2xl font-bold tabular-nums tracking-tight">
          {value}
        </CardTitle>
        {description && (
          <p className="text-xs text-muted-foreground mt-1">{description}</p>
        )}
      </CardContent>
    </Card>
  )
}

function MetricCardSkeleton() {
  return (
    <Card className="gap-3 py-4">
      <CardHeader className="pb-0">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-4 w-4 rounded" />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-3 w-16 mt-2" />
      </CardContent>
    </Card>
  )
}

type KeyMetricsCardsProps = {
  data: KeyMetrics | undefined
  isLoading: boolean
}

export function KeyMetricsCards({ data, isLoading }: KeyMetricsCardsProps) {
  if (isLoading || !data) {
    return (
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <MetricCardSkeleton key={`skeleton-${i.toString()}`} />
        ))}
      </div>
    )
  }

  const currency = data.currency || "USD"

  return (
    <div className="grid gap-4 grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <MetricCard
        title="People"
        value={(data.people ?? 0).toLocaleString()}
        icon={Users}
        accentClass="text-blue-500"
      />
      <MetricCard
        title="Total Revenue"
        value={formatCompact(data.total_revenue, currency)}
        icon={DollarSign}
        description={currency}
        accentClass="text-green-500"
      />
      <MetricCard
        title="Avg Ticket Price"
        value={formatCurrency(data.avg_ticket_price, currency)}
        icon={Receipt}
        accentClass="text-amber-500"
      />
      <MetricCard
        title="Revenue / Person"
        value={formatCurrency(data.avg_revenue_per_person, currency)}
        icon={TrendingUp}
        accentClass="text-violet-500"
      />
      <MetricCard
        title="Conversion Rate"
        value={`${data.conversion_rate ?? 0}%`}
        icon={Percent}
        accentClass="text-emerald-500"
      />
      <MetricCard
        title="% w/ Accommodation"
        value={`${data.accommodation_percentage ?? 0}%`}
        icon={BedDouble}
        accentClass="text-sky-500"
      />
    </div>
  )
}
