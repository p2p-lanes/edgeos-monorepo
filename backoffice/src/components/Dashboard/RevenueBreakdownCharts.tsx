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
import type { RevenueBreakdown } from "@/client"
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
  "oklch(0.75 0.15 130)",
]

function buildChartConfig(items: { label: string }[]): ChartConfig {
  const config: ChartConfig = {}
  for (const [i, item] of items.entries()) {
    config[item.label] = {
      label: item.label,
      color: CHART_COLORS[i % CHART_COLORS.length],
    }
  }
  return config
}

function formatCurrency(value: number, currency: string = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value)
}

type RevenueBreakdownChartsProps = {
  data: RevenueBreakdown | undefined
  isLoading: boolean
  currency?: string
}

export function RevenueBreakdownCharts({
  data,
  isLoading,
  currency = "USD",
}: RevenueBreakdownChartsProps) {
  if (isLoading || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[280px] w-full" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <Skeleton className="h-5 w-40" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-[280px] w-full" />
          </CardContent>
        </Card>
      </div>
    )
  }

  const categories = data.by_category ?? []
  const products = data.by_product ?? []
  const hasCategories = categories.length > 0
  const hasProducts = products.length > 0
  const totalRevenue = categories.reduce((sum, c) => sum + Number(c.revenue), 0)

  // Pie data for category breakdown
  const categoryPieData = categories.map((c) => ({
    name: c.label,
    value: Number(c.revenue),
    quantity: c.quantity,
    fill: `var(--color-${c.label.replace(/\s+/g, "-")})`,
  }))

  const categoryConfig = buildChartConfig(
    categories.map((c) => ({ label: c.label })),
  )

  // Bar data for product breakdown (top 8)
  const productBarData = products
    .sort((a, b) => Number(b.revenue) - Number(a.revenue))
    .slice(0, 8)
    .map((p) => ({
      name:
        p.product_name.length > 20
          ? `${p.product_name.slice(0, 18)}...`
          : p.product_name,
      fullName: p.product_name,
      revenue: Number(p.revenue),
      quantity: p.quantity,
    }))

  const productConfig: ChartConfig = {
    revenue: {
      label: "Revenue",
      color: "var(--chart-1)",
    },
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Revenue by Category — Donut */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue by Category</CardTitle>
          <CardDescription>
            {hasCategories
              ? `${formatCurrency(totalRevenue, currency)} total across ${categories.length} categories`
              : "No revenue data"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasCategories ? (
            <div className="flex flex-col items-center gap-4">
              <ChartContainer
                config={categoryConfig}
                className="h-[240px] w-full max-w-[300px]"
              >
                <PieChart>
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) =>
                          formatCurrency(value as number, currency)
                        }
                      />
                    }
                  />
                  <Pie
                    data={categoryPieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={2}
                    strokeWidth={2}
                  >
                    {categoryPieData.map((entry, i) => (
                      <Cell
                        key={entry.name}
                        fill={CHART_COLORS[i % CHART_COLORS.length]}
                      />
                    ))}
                  </Pie>
                  <text
                    x="50%"
                    y="46%"
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="fill-foreground text-lg font-bold"
                  >
                    {formatCurrency(totalRevenue, currency)}
                  </text>
                  <text
                    x="50%"
                    y="56%"
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="fill-muted-foreground text-[10px]"
                  >
                    total
                  </text>
                </PieChart>
              </ChartContainer>
              {/* Legend */}
              <div className="flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-xs">
                {categories.map((c, i) => (
                  <div key={c.category} className="flex items-center gap-1.5">
                    <div
                      className="h-2.5 w-2.5 rounded-sm shrink-0"
                      style={{
                        backgroundColor: CHART_COLORS[i % CHART_COLORS.length],
                      }}
                    />
                    <span className="text-muted-foreground">{c.label}</span>
                    <span className="font-medium tabular-nums">
                      {formatCurrency(Number(c.revenue), currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="flex h-[280px] items-center justify-center text-muted-foreground text-sm">
              No data available
            </div>
          )}
        </CardContent>
      </Card>

      {/* Revenue by Product — Horizontal Bar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue by Product</CardTitle>
          <CardDescription>
            {hasProducts
              ? `Top ${productBarData.length} products by revenue`
              : "No product data"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {hasProducts ? (
            <ChartContainer config={productConfig} className="h-[280px] w-full">
              <BarChart
                data={productBarData}
                layout="vertical"
                margin={{ top: 0, right: 8, bottom: 0, left: 0 }}
              >
                <CartesianGrid horizontal={false} />
                <YAxis
                  dataKey="name"
                  type="category"
                  tickLine={false}
                  axisLine={false}
                  width={120}
                  tick={{ fontSize: 11 }}
                />
                <XAxis
                  type="number"
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => formatCurrency(v, currency)}
                />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(value, _name, item) => (
                        <span>
                          <span className="font-mono font-medium">
                            {formatCurrency(value as number, currency)}
                          </span>
                          <span className="text-muted-foreground">
                            {" "}
                            ({item.payload.quantity} units)
                          </span>
                        </span>
                      )}
                      labelFormatter={(_label, items) =>
                        items?.[0]?.payload?.fullName || _label
                      }
                    />
                  }
                />
                <Bar
                  dataKey="revenue"
                  fill="var(--color-revenue)"
                  radius={[0, 4, 4, 0]}
                />
              </BarChart>
            </ChartContainer>
          ) : (
            <div className="flex h-[280px] items-center justify-center text-muted-foreground text-sm">
              No data available
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
