import { Calendar1, MapPinned, Speech } from "lucide-react"
import type { HumanPublic } from "@/client"
import { useTenant } from "@/providers/tenantProvider"
import { Card } from "../ui/card"

// LEGACY: popups, total_days, referral_count removed from API – review for deletion
const StatsCards = ({
  userData: _userData,
}: {
  userData: HumanPublic | null
}) => {
  const { tenant } = useTenant()
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Pop-ups attended</p>
            <p className="text-3xl font-bold text-foreground">—</p>
          </div>
          <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center">
            <MapPinned className="w-6 h-6 text-green-500" />
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Days at {tenant?.name}</p>
            <p className="text-3xl font-bold text-foreground">—</p>
          </div>
          <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center">
            <Calendar1 className="w-6 h-6 text-blue-500" />
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Referrals</p>
            <p className="text-3xl font-bold text-foreground">—</p>
          </div>
          <div className="w-12 h-12 bg-purple-500/20 rounded-lg flex items-center justify-center">
            <Speech className="w-6 h-6 text-purple-500" />
          </div>
        </div>
      </Card>
    </div>
  )
}
export default StatsCards
