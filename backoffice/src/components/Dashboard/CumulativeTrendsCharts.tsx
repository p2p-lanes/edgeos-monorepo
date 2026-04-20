import { Area, Bar, CartesianGrid, ComposedChart, XAxis, YAxis } from "recharts"
import type { CumulativeTrends } from "@/client"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart"
import { Skeleton } from "@/components/ui/skeleton"

const ticketChartConfig = {
  cumulative: {
    label: "Cumulative",
    color: "var(--chart-1)",
  },
  value: {
    label: "Daily",
    color: "var(--chart-3)",
  },
} satisfies ChartConfig

const revenueChartConfig = {
  cumulative: {
    label: "Cumulative",
    color: "var(--chart-2)",
  },
  value: {
    label: "Daily",
    color: "var(--chart-4)",
  },
} satisfies ChartConfig

function formatDateTick(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`)
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function formatCurrencyShort(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`
  return `$${value}`
}

type CumulativeTrendsChartsProps = {
  data: CumulativeTrends | undefined
  isLoading: boolean
  currency?: string
}

export function CumulativeTrendsCharts({
  data,
  isLoading,
  currency = "USD",
}: CumulativeTrendsChartsProps) {
  if (isLoading || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-56" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[260px] w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-56" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[260px] w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  const tickets = data.tickets ?? []
  const revenue = data.revenue ?? []
  const hasTickets = tickets.length > 0
  const hasRevenue = revenue.length > 0

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Cumulative Tickets */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cumulative Tickets</CardTitle>
          <CardDescription>
            {hasTickets
              ? `${tickets[tickets.length - 1].cumulative} accepted total`
              : "No accepted applications yet"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasTickets ? (
            <ChartContainer
              config={ticketChartConfig}
              className="h-[260px] w-full"
            >
              <ComposedChart
                data={tickets}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient
                    id="ticketGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor="var(--color-cumulative)"
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-cumulative)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={formatDateTick}
                  interval="preserveStartEnd"
                />
                <YAxis
                  yAxisId="cumulative"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={40}
                />
                <YAxis
                  yAxisId="daily"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  width={30}
                  hide
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(label) =>
                        formatDateTick(label as string)
                      }
                    />
                  }
                />
                <Bar
                  yAxisId="daily"
                  dataKey="value"
                  fill="var(--color-value)"
                  opacity={0.4}
                  radius={[2, 2, 0, 0]}
                />
                <Area
                  yAxisId="cumulative"
                  type="monotone"
                  dataKey="cumulative"
                  stroke="var(--color-cumulative)"
                  fill="url(#ticketGradient)"
                  strokeWidth={2}
                />
              </ComposedChart>
            </ChartContainer>
          ) : (
            <div className="flex h-[260px] items-center justify-center text-muted-foreground text-sm">
              No data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cumulative Revenue */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cumulative Revenue</CardTitle>
          <CardDescription>
            {hasRevenue
              ? `${new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(revenue[revenue.length - 1].cumulative))} total`
              : "No revenue yet"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasRevenue ? (
            <ChartContainer
              config={revenueChartConfig}
              className="h-[260px] w-full"
            >
              <ComposedChart
                data={revenue.map((r) => ({
                  ...r,
                  value: Number(r.value),
                  cumulative: Number(r.cumulative),
                }))}
                margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
              >
                <defs>
                  <linearGradient
                    id="revenueGradient"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor="var(--color-cumulative)"
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor="var(--color-cumulative)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={formatDateTick}
                  interval="preserveStartEnd"
                />
                <YAxis
                  yAxisId="cumulative"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  width={56}
                  tickFormatter={formatCurrencyShort}
                />
                <YAxis
                  yAxisId="daily"
                  orientation="right"
                  tickLine={false}
                  axisLine={false}
                  width={30}
                  hide
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      labelFormatter={(label) =>
                        formatDateTick(label as string)
                      }
                      formatter={(value, name) => {
                        const formatted = new Intl.NumberFormat("en-US", {
                          style: "currency",
                          currency,
                          maximumFractionDigits: 0,
                        }).format(value as number)
                        return (
                          <span>
                            <span className="text-muted-foreground">
                              {name === "cumulative" ? "Cumulative" : "Daily"}:{" "}
                            </span>
                            <span className="font-mono font-medium">
                              {formatted}
                            </span>
                          </span>
                        )
                      }}
                    />
                  }
                />
                <Bar
                  yAxisId="daily"
                  dataKey="value"
                  fill="var(--color-value)"
                  opacity={0.4}
                  radius={[2, 2, 0, 0]}
                />
                <Area
                  yAxisId="cumulative"
                  type="monotone"
                  dataKey="cumulative"
                  stroke="var(--color-cumulative)"
                  fill="url(#revenueGradient)"
                  strokeWidth={2}
                />
              </ComposedChart>
            </ChartContainer>
          ) : (
            <div className="flex h-[260px] items-center justify-center text-muted-foreground text-sm">
              No data available
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
