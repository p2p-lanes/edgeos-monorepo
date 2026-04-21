import { useTranslation } from "react-i18next"
import { ButtonAnimated } from "@/components/ui/button"
import { usePassesProvider } from "@/providers/passesProvider"
import usePurchaseProducts from "../../../hooks/usePurchaseProducts"

const CompletePurchaseButton = ({ edit }: { edit?: boolean }) => {
  const { t } = useTranslation()
  const { purchaseProducts, loading } = usePurchaseProducts()
  const { attendeePasses: attendees } = usePassesProvider()
  const someSelected = attendees.some((attendee) =>
    attendee.products.some(
      (product) =>
        product.selected &&
        (product.purchased ? product.duration_type === "day" : true),
    ),
  )

  return (
    <ButtonAnimated
      disabled={loading || !someSelected}
      loading={loading}
      className="w-full md:w-fit md:min-w-[120px] text-primary-foreground bg-slate-800"
      onClick={() => purchaseProducts(attendees)}
      data-purchase
    >
      {loading
        ? t("common.loading")
        : edit
          ? t("passes.confirm")
          : t("passes.confirm_and_pay")}
    </ButtonAnimated>
  )
}
export default CompletePurchaseButton
