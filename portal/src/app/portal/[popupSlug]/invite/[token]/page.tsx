"use client"

import { useMutation, useQuery } from "@tanstack/react-query"
import { Loader2, Lock } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ApiError, type InvitePublicPreview, InvitesService } from "@/client"
import { Button } from "@/components/ui/button"
import useAuth from "@/hooks/useAuth"
import { useCityProvider } from "@/providers/cityProvider"

function InviteCard({ preview }: { preview: InvitePublicPreview }) {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const city = getCity()
  const { token } = useParams<{ token: string }>()
  const router = useRouter()
  const { user } = useAuth()

  const discount = Number(preview.discount_percentage)

  const redeemMutation = useMutation({
    mutationFn: () =>
      InvitesService.redeemInvite({
        token,
        requestBody: { popup_id: preview.popup_id },
      }),
    onSuccess: () => {
      toast.success(t("invite.redeem_success"))
      if (city?.slug) {
        router.push(`/portal/${city.slug}`)
      }
    },
    onError: (err) => {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          toast.error(t("invite.redeem_error_403"))
        } else if (err.status === 409) {
          toast.error(t("invite.redeem_error_409"))
        } else {
          const detail =
            err.body &&
            typeof err.body === "object" &&
            typeof (err.body as { detail?: unknown }).detail === "string"
              ? (err.body as { detail: string }).detail
              : t("invite.redeem_error_generic")
          toast.error(detail)
        }
      } else {
        toast.error(t("invite.redeem_error_generic"))
      }
    },
  })

  if (!user) {
    return (
      <div className="space-y-4 text-center">
        <Lock className="mx-auto h-8 w-8 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {t("invite.login_required_title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("invite.login_required_description")}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">
          {preview.inviter_name
            ? t("invite.invited_by", { name: preview.inviter_name })
            : t("invite.invited_generic")}
        </h2>
        {preview.is_email_restricted && (
          <p className="text-sm text-amber-600 dark:text-amber-400">
            {t("invite.email_restricted_notice")}
          </p>
        )}
      </div>

      <div className="rounded-lg border bg-muted/40 p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">
            {t("invite.discount_label")}
          </span>
          <span className="font-medium">
            {discount > 0
              ? t("invite.discount_value", { percent: discount })
              : t("invite.no_discount")}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">
            {t("invite.expires_label")}
          </span>
          <span className="font-medium">
            {preview.expires_at
              ? new Date(preview.expires_at).toLocaleDateString()
              : t("invite.no_expiry")}
          </span>
        </div>
        {preview.max_uses != null && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">
              {t("invite.uses_remaining")}
            </span>
            <span className="font-medium">
              {t("invite.uses_remaining", {
                count: preview.max_uses - preview.current_uses,
              })}
            </span>
          </div>
        )}
      </div>

      <Button
        className="w-full"
        onClick={() => redeemMutation.mutate()}
        disabled={redeemMutation.isPending}
      >
        {redeemMutation.isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : null}
        {redeemMutation.isPending
          ? t("invite.redeeming")
          : t("invite.redeem_button")}
      </Button>
    </div>
  )
}

export default function InviteTokenPage() {
  const { t } = useTranslation()
  const { token } = useParams<{ token: string }>()

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

  if (isLoading) {
    return (
      <div className="flex justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const isExpiredOrExhausted = error instanceof ApiError && error.status === 410
  const isNotFound = error instanceof ApiError && error.status === 404

  if (isExpiredOrExhausted) {
    return (
      <div className="max-w-md mx-auto p-6 text-center space-y-2">
        <h1 className="text-xl font-semibold">{t("invite.expired_title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("invite.expired_description")}
        </p>
      </div>
    )
  }

  if (isNotFound || !preview) {
    return (
      <div className="max-w-md mx-auto p-6 text-center space-y-2">
        <h1 className="text-xl font-semibold">{t("invite.not_found_title")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("invite.not_found_description")}
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-md mx-auto p-6">
      <InviteCard preview={preview} />
    </div>
  )
}
