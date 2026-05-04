import { useTranslation } from "react-i18next"
import type { CouponValidatePublicResponse } from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

interface CouponFieldProps {
  code: string
  appliedCoupon: CouponValidatePublicResponse | null
  isPending: boolean
  error: string | null
  onCodeChange: (code: string) => void
  onApply: (code: string) => void
}

export function CouponField({
  code,
  appliedCoupon,
  isPending,
  error,
  onCodeChange,
  onApply,
}: CouponFieldProps) {
  const { t } = useTranslation()
  return (
    <section className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
      <div>
        <h2 className="text-xl font-semibold">
          {t("openCheckout.coupon_title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("openCheckout.coupon_subtitle")}
        </p>
      </div>

      <div className="flex flex-col gap-3 md:flex-row">
        <Input
          value={code}
          onChange={(event) => onCodeChange(event.target.value.toUpperCase())}
          placeholder={t("openCheckout.coupon_placeholder")}
        />
        <Button
          type="button"
          variant="outline"
          onClick={() => onApply(code)}
          disabled={isPending || code.trim().length === 0}
        >
          {isPending
            ? t("openCheckout.coupon_validating")
            : t("openCheckout.coupon_apply")}
        </Button>
      </div>

      {appliedCoupon ? (
        <p className="text-sm text-emerald-600">
          {t("openCheckout.coupon_applied", {
            code: appliedCoupon.code,
            percent: appliedCoupon.discount_value,
          })}
        </p>
      ) : null}

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </section>
  )
}
