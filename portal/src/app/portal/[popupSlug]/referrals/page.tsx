"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, Link2, Loader2, Trash2 } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ApiError, InvitesService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"

function ReferralRow({
  referral,
  onDeleted,
}: {
  referral: {
    id: string
    token: string
    discount_percentage: string
    current_uses: number
    max_uses?: number | null
    expires_at?: string | null
    is_disabled?: boolean
  }
  onDeleted: () => void
}) {
  const { t } = useTranslation()
  const [deleteOpen, setDeleteOpen] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => InvitesService.deleteMyLink({ linkId: referral.id }),
    onSuccess: () => {
      toast.success(t("referrals.delete_success"))
      setDeleteOpen(false)
      onDeleted()
    },
    onError: () => {
      toast.error(t("referrals.delete_error"))
    },
  })

  const referralUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/r/${referral.token}`
      : `/r/${referral.token}`

  const handleCopy = () => {
    navigator.clipboard.writeText(referralUrl).then(() => {
      toast.success(t("referrals.link_copied"))
    })
  }

  const discount = Number(referral.discount_percentage)
  const discountLabel = discount > 0 ? `${discount}%` : t("referrals.no_expiry")

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {referral.token}
            {referral.is_disabled && (
              <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                {t("referrals.disabled_badge")}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("referrals.discount_label")}: {discountLabel} &middot;{" "}
            {t("referrals.uses_label")}:{" "}
            {referral.max_uses != null
              ? `${referral.current_uses}/${referral.max_uses}`
              : referral.current_uses}{" "}
            &middot; {t("referrals.expires_label")}:{" "}
            {referral.expires_at
              ? new Date(referral.expires_at).toLocaleDateString()
              : t("referrals.no_expiry")}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          onClick={handleCopy}
          title={t("referrals.copy_link")}
          aria-label={t("referrals.copy_link")}
        >
          <Copy className="h-4 w-4" />
        </Button>
        <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <DialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              title={t("referrals.delete_referral")}
              aria-label={t("referrals.delete_referral")}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("referrals.delete_confirm_title")}</DialogTitle>
              <DialogDescription>
                {t("referrals.delete_confirm_description")}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDeleteOpen(false)}
                disabled={deleteMutation.isPending}
              >
                {t("referrals.delete_cancel")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending}
              >
                {deleteMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                {t("referrals.delete_confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}

const ReferralsPage = () => {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const city = getCity()
  const queryClient = useQueryClient()
  const { getRelevantApplication } = useApplication()
  // The door this screen is about. Without it, someone holding two
  // applications was answered with whichever came last
  // (sdd/sales-flows-rediseno).
  const flowId = useSearchParams().get("flow")
  const application = getRelevantApplication(flowId)
  // Only attendees who actually hold a ticket for this popup may create a
  // referral link (anti-abuse — mirrors the backend gate). Acceptance alone is
  // not enough: invite/referral arrivals are auto-accepted without committing.
  const hasTicket = !!application?.attendees?.some(
    (a) => ((a.products as unknown[] | undefined) ?? []).length > 0,
  )

  const { data, isLoading } = useQuery({
    queryKey: ["referrals", "mine", city?.id ?? ""],
    queryFn: () =>
      InvitesService.listMyLinks({ popupId: city!.id, limit: 100 }),
    enabled: !!city?.id && hasTicket,
  })

  const createMutation = useMutation({
    mutationFn: () =>
      InvitesService.createMyLink({
        requestBody: { popup_id: city!.id },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["referrals", "mine", city?.id ?? ""],
      })
    },
    onError: (err) => {
      const detail =
        err instanceof ApiError &&
        err.body &&
        typeof err.body === "object" &&
        typeof (err.body as { detail?: unknown }).detail === "string"
          ? (err.body as { detail: string }).detail
          : t("referrals.create_error")
      toast.error(detail)
    },
  })

  if (!hasTicket) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-sm text-muted-foreground">
          {t("referrals.needs_ticket")}
        </p>
      </div>
    )
  }

  const referrals = data?.results ?? []
  // 1-link-per-attendee rule: hide Create once the human has a referral
  const hasReferral = referrals.length > 0

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("referrals.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("referrals.description")}
          </p>
        </div>
        {!hasReferral && (
          <Button
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {createMutation.isPending
              ? t("referrals.creating")
              : t("referrals.create_referral")}
          </Button>
        )}
      </div>

      {isLoading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : referrals.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <p className="text-sm text-muted-foreground">
            {t("referrals.no_referrals")}
          </p>
        </div>
      ) : (
        <>
          {hasReferral && (
            <p className="text-sm text-muted-foreground">
              {t("referrals.one_link_notice")}
            </p>
          )}
          <div className="space-y-2">
            {referrals.map((ref) => (
              <ReferralRow
                key={ref.id}
                referral={ref}
                onDeleted={() =>
                  queryClient.invalidateQueries({
                    queryKey: ["referrals", "mine", city?.id ?? ""],
                  })
                }
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default ReferralsPage
