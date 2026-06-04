"use client"

import { useQuery } from "@tanstack/react-query"
import { useParams, useRouter } from "next/navigation"
import { useEffect } from "react"
import { PopupCheckoutContent } from "@/app/checkout/components/PopupCheckoutContent"
import { ApiError, InvitesService, PortalService } from "@/client"
import { CheckoutBackgroundVideo } from "@/components/CheckoutBackgroundVideo"
import { Loader } from "@/components/ui/Loader"
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
  const router = useRouter()
  const { getCity, getPopups, popupsLoaded, setCityPreselected } =
    useCityProvider()
  const { group, loading, error } = useGetPublicGroup(params.groupSlug)
  const { setDiscount, discountApplied } = useDiscount()

  // When the group is found, also run the slug resolution to detect if
  // this slug was migrated to an invite (kind="invite"). If so, redirect
  // to the canonical invite redemption page inside the portal.
  const { data: resolution } = useQuery({
    queryKey: ["group-slug-resolution", group?.popup_id, params.groupSlug],
    queryFn: () =>
      PortalService.resolveGroupSlug({
        slug: params.groupSlug,
        popupId: group!.popup_id,
      }),
    enabled: !!group?.popup_id,
    retry: false,
  })

  // If the group was not found by the public endpoint, try to resolve it
  // as an invite token. A migrated bulk/masivos group is now an invite
  // whose token matches the old slug.
  const groupNotFound = error != null || (!loading && group == null)

  const { data: invitePreview, isLoading: inviteLoading } = useQuery({
    queryKey: ["invite-preview-fallback", params.groupSlug],
    queryFn: () => InvitesService.previewInvite({ token: params.groupSlug }),
    enabled: groupNotFound && !!params.groupSlug,
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

  // Redirect: slug resolved to an invite — send to the checkout invite page.
  // We find the popup slug from the loaded popups list using invite.popup_id.
  useEffect(() => {
    if (!resolution) return
    if (resolution.kind !== "invite") return
    const invite = resolution.invite as {
      popup_id?: string
      token?: string
    } | null
    if (!invite) return
    const popupId = invite.popup_id ?? group?.popup_id
    const token = invite.token ?? params.groupSlug
    if (!popupId) {
      // Fallback: redirect to invite page without popup context
      router.replace(`/invite/${token}`)
      return
    }
    const popupsList = getPopups()
    const popup = popupsList.find((p) => p.id === popupId)
    if (popup) {
      router.replace(`/portal/${popup.slug}/invite/${token}`)
    } else {
      router.replace(`/invite/${token}`)
    }
  }, [resolution, group?.popup_id, params.groupSlug, router, getPopups])

  // Redirect: group 404 but invite preview found
  useEffect(() => {
    if (!groupNotFound) return
    if (!invitePreview) return
    const token = params.groupSlug
    const popupsList = getPopups()
    const popup = popupsList.find((p) => p.id === invitePreview.popup_id)
    if (popup) {
      router.replace(`/portal/${popup.slug}/invite/${token}`)
    } else {
      router.replace(`/invite/${token}`)
    }
  }, [groupNotFound, invitePreview, params.groupSlug, router, getPopups])

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
  // public group payload we already fetched.
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

  // Show loader while:
  // - group is loading
  // - resolution is pending (may redirect)
  // - group not found but invite lookup is in progress
  if (loading || !popupsLoaded) {
    return <LoadingFallback />
  }

  // Redirect in progress (invite detected via resolution or fallback)
  if (
    (resolution && resolution.kind === "invite") ||
    (groupNotFound && (inviteLoading || invitePreview))
  ) {
    return <Loader />
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
        groupId={group.id}
      />
    </>
  )
}

export default GroupCheckoutPage
