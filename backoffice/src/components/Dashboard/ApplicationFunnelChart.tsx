import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"
import type { ApplicationFunnel } from "@/client"
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

const FUNNEL_COLORS = [
  "oklch(0.65 0.15 260)", // draft — blue-ish
  "oklch(0.75 0.18 80)", // pending_fee — amber
  "oklch(0.7 0.15 200)", // in_review — teal
  "oklch(0.65 0.2 145)", // accepted — green
  "oklch(0.55 0.22 160)", // paid — dark green
]

const funnelConfig = {
  draft: { label: "Draft", color: FUNNEL_COLORS[0] },
  pending_fee: { label: "Pending Fee", color: FUNNEL_COLORS[1] },
  in_review: { label: "In Review", color: FUNNEL_COLORS[2] },
  accepted: { label: "Accepted", color: FUNNEL_COLORS[3] },
  paid: { label: "Paid", color: FUNNEL_COLORS[4] },
} satisfies ChartConfig

type ApplicationFunnelChartProps = {
  data: ApplicationFunnel | undefined
  isLoading: boolean
}

export function ApplicationFunnelChart({
  data,
  isLoading,
}: ApplicationFunnelChartProps) {
  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3 w-56" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[220px] w-full" />
        </CardContent>
      </Card>
    )
  }

  const draft = data.draft ?? 0
  const pendingFee = data.pending_fee ?? 0
  const inReview = data.in_review ?? 0
  const accepted = data.accepted ?? 0
  const paid = data.paid ?? 0
  const total = draft + pendingFee + inReview + accepted
  const barData = [
    { stage: "Draft", value: draft },
    { stage: "Pending Fee", value: pendingFee },
    { stage: "In Review", value: inReview },
    { stage: "Accepted", value: accepted },
    { stage: "Paid", value: paid },
  ]

  const hasData = total > 0 || paid > 0

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Application Pipeline</CardTitle>
        <CardDescription>
          {hasData
            ? `${total} applications, ${paid} paid`
            : "No applications yet"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <ChartContainer config={funnelConfig} className="h-[220px] w-full">
            <BarChart
              data={barData}
              margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="stage"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tick={{ fontSize: 11 }}
              />
              <YAxis tickLine={false} axisLine={false} width={40} />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                {barData.map((entry, i) => (
                  <Cell
                    key={entry.stage}
                    fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ChartContainer>
        ) : (
          <div className="flex h-[220px] items-center justify-center text-muted-foreground text-sm">
            No data available
          </div>
        )}
      </CardContent>
    </Card>
  )
}
