"use client"

import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useEffect } from "react"
import { ApiError, InvitesService } from "@/client"
import { useCityProvider } from "@/providers/cityProvider"

/**
 * Top-level invite page — reached when redirect from /groups/[slug] cannot
 * resolve a popup slug. Fetches the invite preview (which includes popup_id),
 * then redirects to the portal-scoped invite page.
 */
export default function TopLevelInvitePage() {
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const { getPopups, popupsLoaded } = useCityProvider()

  const {
    data: preview,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["invite-preview-top", token],
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

  useEffect(() => {
    if (!preview || !popupsLoaded) return
    const popup = getPopups().find((p) => p.id === preview.popup_id)
    if (popup) {
      router.replace(`/portal/${popup.slug}/invite/${token}`)
    }
  }, [preview, popupsLoaded, token, router, getPopups])

  if (isLoading || (preview && !error)) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  // Invite not found or expired — show a minimal error
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
      <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-bold text-neutral-900">
          Invite not found
        </h1>
        <p className="mt-3 text-sm text-neutral-600">
          This invite link is invalid, expired, or no longer available.
        </p>
      </div>
    </div>
  )
}
