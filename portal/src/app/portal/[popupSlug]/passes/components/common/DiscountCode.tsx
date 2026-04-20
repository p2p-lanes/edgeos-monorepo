import { CheckCircle, Loader2, XCircle } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useDiscount } from "@/providers/discountProvider"
import useDiscountCode from "../../hooks/useDiscountCode"

const DiscountCode = ({
  defaultOpen = false,
  label = true,
}: {
  defaultOpen?: boolean
  label?: boolean
}) => {
  const { t } = useTranslation()
  const { discountApplied } = useDiscount()
  const hasPreAppliedCode = !!discountApplied.discount_code
  const [open, setOpen] = useState(defaultOpen || hasPreAppliedCode)
  const [discountCode, setDiscountCode] = useState(
    discountApplied.discount_code ?? "",
  )
  const {
    getDiscountCode,
    loading,
    discountMsg,
    validDiscount,
    clearDiscountMessage,
  } = useDiscountCode()
  const isValid = validDiscount || hasPreAppliedCode

  const handleApplyDiscount = () => {
    getDiscountCode(discountCode)
  }

  const handleDiscountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setDiscountCode(e.target.value)
    clearDiscountMessage()
  }

  return (
    <div className="flex px-0 gap-4">
      {label && (
        <button
          type="button"
          className="text-sm font-medium underline whitespace-nowrap cursor-pointer my-2"
          onClick={() => setOpen(!open)}
        >
          {t("passes.have_coupon")}
        </button>
      )}
      {open ? (
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-end gap-4">
            <Input
              disabled={loading || isValid}
              error={
                !isValid && !!discountMsg && discountCode.length > 0
                  ? discountMsg
                  : ""
              }
              placeholder={t("passes.coupon_placeholder")}
              className="bg-card text-foreground"
              data-discount-code={discountCode}
              value={discountCode.toUpperCase()}
              onChange={handleDiscountChange}
              onKeyDown={(e) => {
                if (e.key === "Enter" && discountCode.length > 0 && !loading) {
                  handleApplyDiscount()
                }
              }}
              autoFocus={!hasPreAppliedCode}
            />
            <Button
              variant="secondary"
              className="hover:no-underline font-bold text-[#7F22FE] bg-[#7F22FE]/10"
              onClick={handleApplyDiscount}
              disabled={discountCode.length === 0 || loading || isValid}
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              {t("common.apply")}
            </Button>
          </div>
          {!loading && discountCode.length > 0 && (discountMsg || isValid) && (
            <p
              className={`flex items-center gap-1 text-xs ${isValid ? "text-green-500" : "text-destructive"}`}
            >
              {isValid ? (
                <CheckCircle className="w-4 h-4 text-green-500" />
              ) : (
                <XCircle className="w-4 h-4 text-destructive" />
              )}
              {isValid ? t("passes.coupon_applied") : discountMsg}
            </p>
          )}
        </div>
      ) : null}
    </div>
  )
}

export default DiscountCode
