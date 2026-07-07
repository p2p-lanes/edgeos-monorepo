"use client"

import { useParams } from "next/navigation"
import { useEffect } from "react"
import { PopupCheckoutContent } from "@/app/checkout/components/PopupCheckoutContent"
import { CheckoutBackgroundImage } from "@/components/CheckoutBackgroundImage"
import { CheckoutBackgroundVideo } from "@/components/CheckoutBackgroundVideo"
import useGetPublicGroup from "@/hooks/useGetPublicGroup"
import { getCheckoutBackground } from "@/lib/background-image"
import { useCityProvider } from "@/providers/cityProvider"
import { useDiscount } from "@/providers/discountProvider"

const LoadingFallback = () => (
  <div className="flex items-center justify-center h-screen">
    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
  </div>
)

const GroupCheckoutPage = () => {
  const params = useParams<{ groupSlug: string }>()
  const { getCity, getPopups, popupsLoaded, setCityPreselected } =
    useCityProvider()
  const { group, loading, error } = useGetPublicGroup(params.groupSlug)
  const { setDiscount, discountApplied } = useDiscount()

  // Pre-select the popup as soon as we know it so the DiscountProvider's
  // city-reset effect settles on this popup's id BEFORE we seed the discount.
  useEffect(() => {
    if (group?.popup_id) {
      setCityPreselected(group.popup_id)
    }
  }, [group?.popup_id, setCityPreselected])

  // The portal's DiscountProvider reads group discounts from /groups/my/groups,
  // which only lists groups where the user is a leader (find_by_leader). Buyers
  // arriving via /groups/{slug} are added as members, so that query returns
  // empty and the cart skips the discount. Seed the discount directly from the
  // public group payload we already fetched. This is intentionally narrow —
  // the upcoming groups SDD reworks the membership/discount surfaces.
  //
  // We depend on BOTH `discountApplied.discount_value` and `.city_id` so the
  // effect re-fires in the commit AFTER the DiscountProvider's city-reset
  // (discountProvider.tsx:39-48) settles. That reset uses setDiscountApplied
  // directly, bypassing our setDiscount's downgrade guard — if both fired in
  // the same commit, the reset's "last write wins" wiped our value. Re-firing
  // once city_id is stable lets our setDiscount land cleanly without further
  // reset interference.
  const currentCity = getCity()
  useEffect(() => {
    if (!group?.discount_percentage) return
    if (currentCity?.id !== group.popup_id) return
    if (discountApplied.city_id !== currentCity.id) return
    const discountValue = Number(group.discount_percentage)
    if (!Number.isFinite(discountValue) || discountValue <= 0) return
    if (discountApplied.discount_value >= discountValue) return
    setDiscount({
      discount_value: discountValue,
      discount_type: "percentage",
      discount_code: null,
      city_id: currentCity.id,
    })
  }, [
    group?.discount_percentage,
    group?.popup_id,
    currentCity?.id,
    discountApplied.discount_value,
    discountApplied.city_id,
    setDiscount,
  ])

  if (loading || !popupsLoaded) {
    return <LoadingFallback />
  }

  const popup = getPopups().find((item) => item.id === group?.popup_id)

  if (error || !group || !popup) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-bold text-neutral-900">
            Group not found
          </h1>
          <p className="mt-3 text-sm text-neutral-600">
            The group link is invalid or this event is no longer available.
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
        groupId={group.id}
      />
    </>
  )
}

export default GroupCheckoutPage
