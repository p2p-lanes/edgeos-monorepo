"use client"

import { useQuery } from "@tanstack/react-query"
import { Lock } from "lucide-react"
import { useParams } from "next/navigation"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { PopupCheckoutContent } from "@/app/checkout/components/PopupCheckoutContent"
import { ApiError, ReferralsService } from "@/client"
import { CheckoutBackgroundVideo } from "@/components/CheckoutBackgroundVideo"
import { getCheckoutBackground } from "@/lib/background-image"
import { useCityProvider } from "@/providers/cityProvider"
import { useDiscount } from "@/providers/discountProvider"

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-screen">
    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
  </div>
)

/**
 * Public referral checkout page — /r/[code]
 *
 * Mirrors /invite/[token]/page.tsx exactly:
 * - No login gate (authentication happens inside PopupCheckoutContent)
 * - Seeds discount from referral.discount_percentage
 * - Preselects the popup so DiscountProvider settles before discount seed
 * - Renders PopupCheckoutContent with referralId (no groupId → no membership)
 *
 * The resulting application carries referral_id for attribution (REQ-GR-009).
 */
export default function ReferralCodePage() {
  const { t } = useTranslation()
  const { code } = useParams<{ code: string }>()
  const { getPopups, popupsLoaded, setCityPreselected } = useCityProvider()
  const { setDiscount, discountApplied } = useDiscount()

  const {
    data: preview,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["referral-preview-top", code],
    queryFn: () => ReferralsService.getReferralPreview({ code }),
    enabled: !!code,
    retry: (failureCount, err) => {
      if (
        err instanceof ApiError &&
        (err.status === 404 || err.status === 410)
      ) {
        return false
      }
      return failureCount < 1
    },
  })

  // Pre-select the popup so DiscountProvider's city-reset settles on this
  // popup's id BEFORE we seed the discount (mirrors invite page).
  useEffect(() => {
    if (preview?.popup_id) {
      setCityPreselected(preview.popup_id)
    }
  }, [preview?.popup_id, setCityPreselected])

  // Seed discount from the referral payload — the portal DiscountProvider does
  // not know about referral discounts, so we push it explicitly (mirrors invite page).
  const currentCity = getPopups().find((p) => p.id === preview?.popup_id)
  useEffect(() => {
    if (!preview?.discount_percentage) return
    if (currentCity?.id !== preview.popup_id) return
    if (discountApplied.city_id !== currentCity.id) return
    const discountValue = Number(preview.discount_percentage)
    if (!Number.isFinite(discountValue) || discountValue <= 0) return
    if (discountApplied.discount_value >= discountValue) return
    setDiscount({
      discount_value: discountValue,
      discount_type: "percentage",
      discount_code: null,
      city_id: currentCity.id,
    })
  }, [
    preview?.discount_percentage,
    preview?.popup_id,
    currentCity?.id,
    discountApplied.discount_value,
    discountApplied.city_id,
    setDiscount,
  ])

  if (isLoading || !popupsLoaded) {
    return <LoadingFallback />
  }

  const popup = getPopups().find((p) => p.id === preview?.popup_id)

  const isExhausted = error instanceof ApiError && error.status === 410

  if (isExhausted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <Lock className="mx-auto mb-4 h-8 w-8 text-muted-foreground" />
          <h1 className="text-2xl font-bold text-neutral-900">
            {t("referrals.preview_exhausted_title")}
          </h1>
          <p className="mt-3 text-sm text-neutral-600">
            {t("referrals.preview_exhausted_description")}
          </p>
        </div>
      </div>
    )
  }

  if (error || !preview || !popup) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold text-neutral-900">
            {t("referrals.preview_not_found_title")}
          </h1>
          <p className="mt-3 text-sm text-neutral-600">
            {t("referrals.preview_not_found_description")}
          </p>
        </div>
      </div>
    )
  }

  const background = getCheckoutBackground(popup, "groups")
  const contentBackground =
    background.type === "image"
      ? { className: "", style: background.style }
      : { className: background.type === "none" ? "bg-background" : "" }

  return (
    <>
      {background.type === "video" && (
        <CheckoutBackgroundVideo url={background.url} />
      )}
      <PopupCheckoutContent
        popup={popup}
        background={contentBackground}
        referralId={preview.id}
      />
    </>
  )
}
