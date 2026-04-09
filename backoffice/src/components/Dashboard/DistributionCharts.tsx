import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  XAxis,
  YAxis,
} from "recharts"
import type { AttachRateItem, Distribution } from "@/client"
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

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "oklch(0.7 0.15 200)",
  "oklch(0.6 0.2 340)",
]

type DistributionChartsProps = {
  data: Distribution | undefined
  isLoading: boolean
}

export function DistributionCharts({
  data,
  isLoading,
}: DistributionChartsProps) {
  if (isLoading || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={`dist-skeleton-${i.toString()}`}>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent>
              <Skeleton className="h-[200px] w-full" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  const ticketsByDuration = data.tickets_by_duration ?? []
  const ticketsByAttendee = data.tickets_by_attendee_type ?? []
  const housingProducts = data.accommodation_by_product ?? []
  const attachRates = data.accommodation_attach_rate ?? []
  const hasDuration = ticketsByDuration.length > 0
  const hasAttendeeType = ticketsByAttendee.length > 0
  const hasHousing = housingProducts.length > 0
  const hasAttachRate = attachRates.length > 0

  const toDonut = (items: typeof ticketsByDuration): DonutItem[] =>
    items.map((d) => ({
      name: d.label,
      value: d.value ?? 0,
      percentage: Number(d.percentage ?? 0),
    }))

  // Count meaningful slices (>0 value) per dataset
  const durationSlices = ticketsByDuration.filter((d) => (d.value ?? 0) > 0)
  const attendeeSlices = ticketsByAttendee.filter((d) => (d.value ?? 0) > 0)
  const housingSlices = housingProducts.filter((d) => (d.value ?? 0) > 0)

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {/* Tickets by Duration */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tickets by Type</CardTitle>
          <CardDescription>
            {hasDuration
              ? `${ticketsByDuration.reduce((s, d) => s + (d.value ?? 0), 0)} total tickets`
              : "No ticket data"}
          </CardDescription>
        </CardHeader>
        <CardContent className="min-h-[220px] flex items-center justify-center">
          {!hasDuration ? (
            <EmptyState />
          ) : durationSlices.length <= 1 ? (
            <SingleStatDisplay items={toDonut(durationSlices)} />
          ) : (
            <DonutWithLegend items={toDonut(ticketsByDuration)} />
          )}
        </CardContent>
      </Card>

      {/* Tickets by Attendee Type */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Tickets by Attendee</CardTitle>
          <CardDescription>
            {hasAttendeeType
              ? `${ticketsByAttendee.reduce((s, d) => s + (d.value ?? 0), 0)} total`
              : "No data"}
          </CardDescription>
        </CardHeader>
        <CardContent className="min-h-[220px] flex items-center justify-center">
          {!hasAttendeeType ? (
            <EmptyState />
          ) : attendeeSlices.length <= 1 ? (
            <SingleStatDisplay items={toDonut(attendeeSlices)} />
          ) : (
            <DonutWithLegend items={toDonut(ticketsByAttendee)} />
          )}
        </CardContent>
      </Card>

      {/* Accommodation breakdown or Attach Rate */}
      {hasHousing || hasAttachRate ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {hasHousing ? "Accommodation Mix" : "Accommodation Rate"}
            </CardTitle>
            <CardDescription>
              {hasHousing
                ? `${housingProducts.reduce((s, d) => s + (d.value ?? 0), 0)} total accommodations`
                : "Attach rate by ticket type"}
            </CardDescription>
          </CardHeader>
          <CardContent className="min-h-[220px] flex items-center justify-center">
            {hasHousing ? (
              housingSlices.length <= 1 ? (
                <SingleStatDisplay items={toDonut(housingSlices)} />
              ) : (
                <DonutWithLegend items={toDonut(housingProducts)} />
              )
            ) : hasAttachRate ? (
              <AttachRateBar items={attachRates} />
            ) : (
              <EmptyState />
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Accommodation</CardTitle>
            <CardDescription>No accommodation data</CardDescription>
          </CardHeader>
          <CardContent className="min-h-[220px] flex items-center justify-center">
            <EmptyState />
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// --- Internal components ---

type DonutItem = { name: string; value: number; percentage: number }

/** When there's only 1 meaningful slice, show a clean stat instead of a useless donut */
function SingleStatDisplay({ items }: { items: DonutItem[] }) {
  if (items.length === 0) return <EmptyState />
  const item = items[0]
  return (
    <div className="flex flex-col items-center justify-center gap-1.5">
      <span className="text-4xl font-bold tabular-nums">{item.value}</span>
      <span className="text-sm text-muted-foreground">{item.name}</span>
      <span className="text-xs text-muted-foreground">100% of total</span>
    </div>
  )
}

function DonutWithLegend({ items }: { items: DonutItem[] }) {
  const config: ChartConfig = {}
  for (const [i, item] of items.entries()) {
    config[item.name] = {
      label: item.name,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }
  }

  const total = items.reduce((s, i) => s + i.value, 0)

  return (
    <div className="flex flex-col items-center gap-3">
      <ChartContainer
        config={config}
        className="h-[160px] w-full max-w-[200px]"
      >
        <PieChart>
          <ChartTooltip content={<ChartTooltipContent />} />
          <Pie
            data={items}
            dataKey="value"
            nameKey="name"
            innerRadius={40}
            outerRadius={72}
            paddingAngle={2}
            strokeWidth={2}
          >
            {items.map((entry, i) => (
              <Cell
                key={entry.name}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
              />
            ))}
          </Pie>
          <text
            x="50%"
            y="50%"
            textAnchor="middle"
            dominantBaseline="central"
            className="fill-foreground text-lg font-bold"
          >
            {total}
          </text>
        </PieChart>
      </ChartContainer>
      <div className="flex flex-wrap justify-center gap-x-3 gap-y-1 text-xs w-full">
        {items.map((item, i) => (
          <div key={item.name} className="flex items-center gap-1.5">
            <div
              className="h-2 w-2 rounded-sm shrink-0"
              style={{
                backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
              }}
            />
            <span className="text-muted-foreground">{item.name}</span>
            <span className="font-medium tabular-nums">
              {item.value}
              <span className="text-muted-foreground ml-0.5">
                ({item.percentage}%)
              </span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AttachRateBar({ items }: { items: AttachRateItem[] }) {
  const config: ChartConfig = {
    rate: { label: "Attach Rate", color: "var(--chart-2)" },
  }

  const barData = items.map((item) => ({
    name: item.ticket_type,
    rate: Number(item.rate),
    total: item.total_attendees,
    withAccomm: item.with_accommodation,
  }))

  return (
    <ChartContainer config={config} className="h-[200px] w-full">
      <BarChart data={barData} layout="vertical" margin={{ left: 0, right: 8 }}>
        <CartesianGrid horizontal={false} />
        <YAxis
          dataKey="name"
          type="category"
          tickLine={false}
          axisLine={false}
          width={90}
          tick={{ fontSize: 11 }}
        />
        <XAxis
          type="number"
          tickLine={false}
          axisLine={false}
          domain={[0, 100]}
          tickFormatter={(v: number) => `${v}%`}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              formatter={(value, _name, item) => (
                <span>
                  <span className="font-mono font-medium">{value}%</span>
                  <span className="text-muted-foreground">
                    {" "}
                    ({item.payload.withAccomm}/{item.payload.total})
                  </span>
                </span>
              )}
            />
          }
        />
        <Bar dataKey="rate" fill="var(--color-rate)" radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartContainer>
  )
}

function EmptyState() {
  return (
    <div className="flex items-center justify-center text-muted-foreground text-sm">
      No data available
    </div>
  )
}
