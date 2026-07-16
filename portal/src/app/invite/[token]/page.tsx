"use client"

import { useQuery } from "@tanstack/react-query"
import { useParams, useRouter } from "next/navigation"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { PopupCheckoutContent } from "@/app/checkout/components/PopupCheckoutContent"
import { ApiError, InvitesService } from "@/client"
import { CheckoutBackgroundImage } from "@/components/CheckoutBackgroundImage"
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
 * Public invite checkout page — /invite/[token]
 *
 * Mirrors /groups/[groupSlug]/page.tsx exactly:
 * - No login gate (authentication happens inside PopupCheckoutContent)
 * - Seeds discount from invite.discount_percentage
 * - Preselects the popup so DiscountProvider settles before discount seed
 * - Renders PopupCheckoutContent with inviteId (no groupId → no membership)
 *
 * The ONLY difference from the group flow: inviteId is passed instead of
 * groupId, so no GroupMembers row is ever inserted.
 */
export default function InviteCheckoutPage() {
  const { t } = useTranslation()
  const router = useRouter()
  const { token } = useParams<{ token: string }>()
  const { getPopups, popupsLoaded, setCityPreselected } = useCityProvider()
  const { setDiscount, discountApplied } = useDiscount()

  const {
    data: preview,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: () => InvitesService.previewInvite({ token }),
    enabled: !!token,
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
  // popup's id BEFORE we seed the discount (mirrors group page).
  useEffect(() => {
    if (preview?.popup_id) {
      setCityPreselected(preview.popup_id)
    }
  }, [preview?.popup_id, setCityPreselected])

  // Seed discount from the invite payload — the portal DiscountProvider does
  // not know about invite discounts, so we push it explicitly (mirrors group page).
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

  // A redeemer who re-opens the link is recognized by the auth-aware preview:
  // send them to their portal checkout instead of the now-consumed invite page.
  useEffect(() => {
    if (!preview?.already_redeemed) return
    const redeemedPopup = getPopups().find((p) => p.id === preview.popup_id)
    if (redeemedPopup?.slug) {
      router.replace(`/portal/${redeemedPopup.slug}`)
    }
  }, [preview?.already_redeemed, preview?.popup_id, getPopups, router])

  if (isLoading || !popupsLoaded || preview?.already_redeemed) {
    return <LoadingFallback />
  }

  const popup = getPopups().find((p) => p.id === preview?.popup_id)

  if (error || !preview || !popup) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold text-neutral-900">
            {t("invite.not_found_title")}
          </h1>
          <p className="mt-3 text-sm text-neutral-600">
            {t("invite.not_found_description")}
          </p>
        </div>
      </div>
    )
  }

  const background = getCheckoutBackground(popup, "groups")
  const contentBackground = {
    className: background.type === "none" ? "bg-background" : "",
  }

  return (
    <>
      {background.type === "image" && (
        <CheckoutBackgroundImage url={background.url} />
      )}
      {background.type === "video" && (
        <CheckoutBackgroundVideo url={background.url} />
      )}
      <PopupCheckoutContent
        popup={popup}
        background={contentBackground}
        inviteId={preview.id}
      />
    </>
  )
}
