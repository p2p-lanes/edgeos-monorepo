"use client"

import { useQuery } from "@tanstack/react-query"
import { Loader2, Lock } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { ApiError, ReferralsService } from "@/client"
import { useCityProvider } from "@/providers/cityProvider"

/**
 * Top-level referral consumption page — reached via /r/{code}.
 *
 * Flow:
 * 1. Fetch GET /referrals/r/{code} → ReferralPublicPreview (includes `id` and `popup_id`).
 * 2. If not found / expired / exhausted → show a friendly i18n error state.
 * 3. Resolve the popup from popup_id, then redirect to the portal application
 *    page carrying referral_id as a URL search param so the application form
 *    can pass it to ApplicationsService.createMyApplication.
 *
 * REQ-GR-009: Referral attribution on application.
 */
export default function ReferralCodePage() {
  const { t } = useTranslation()
  const { code } = useParams<{ code: string }>()
  const router = useRouter()
  const { getPopups, popupsLoaded } = useCityProvider()

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

  useEffect(() => {
    if (!preview || !popupsLoaded) return
    const popup = getPopups().find((p) => p.id === preview.popup_id)
    if (popup) {
      // Carry the referral UUID to the application form via URL param.
      // The application page and use-submit-application hook read this param
      // and include it in the ApplicationCreate payload (referral_id field).
      router.replace(
        `/portal/${popup.slug}/application?referral_id=${preview.id}`,
      )
    }
  }, [preview, popupsLoaded, router, getPopups])

  if (isLoading || (preview && !error)) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const isExhausted = error instanceof ApiError && error.status === 410
  const isNotFound = error instanceof ApiError && error.status === 404

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

  if (isNotFound || !preview) {
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

  // Loading state — should rarely be reached
  return (
    <div className="flex items-center justify-center h-screen">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
    </div>
  )
}
