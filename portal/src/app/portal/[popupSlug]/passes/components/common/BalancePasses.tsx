import { useTranslation } from "react-i18next"
import { useCalculateTotal } from "@/hooks/useCalculateTotal"
import { usePassesProvider } from "@/providers/passesProvider"

const BalancePasses = () => {
  const { t } = useTranslation()
  const { balance } = useCalculateTotal()
  const { isEditing } = usePassesProvider()

  if (!isEditing) return null

  return (
    <div className="flex items-center gap-4 w-fit">
      <span className="text-2xl font-semibold">{t("passes.balance")}</span>
      <span className="text-2xl font-semibold text-neutral-500">
        {balance >= 0 ? `$0` : ` $${-balance.toFixed(2)}`}
      </span>
    </div>
  )
}
export default BalancePasses
