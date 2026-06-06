import { Calendar1, MapPinned } from "lucide-react"
import type { HumanProfileStats } from "@/client"
import { useTenant } from "@/providers/tenantProvider"
import { Card } from "../ui/card"

interface StatsCardsProps {
  stats: HumanProfileStats | null
  isLoading: boolean
}

const StatsCards = ({ stats, isLoading }: StatsCardsProps) => {
  const { tenant } = useTenant()
  const popupsAttended = stats?.popups.length ?? null
  const totalDays = stats?.total_days ?? null

  const renderValue = (value: number | null) => {
    if (isLoading) return "…"
    if (value === null) return "—"
    return value
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground mb-1">
              Pop-ups attended
            </p>
            <p className="text-3xl font-bold text-foreground">
              {renderValue(popupsAttended)}
            </p>
          </div>
          <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center">
            <MapPinned className="w-6 h-6 text-green-500" />
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground mb-1">
              Days at {tenant?.name}
            </p>
            <p className="text-3xl font-bold text-foreground">
              {renderValue(totalDays)}
            </p>
          </div>
          <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center">
            <Calendar1 className="w-6 h-6 text-blue-500" />
          </div>
        </div>
      </Card>
    </div>
  )
}
export default StatsCards
