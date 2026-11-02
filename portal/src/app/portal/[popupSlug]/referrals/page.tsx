"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Copy, Link2, Loader2, Trash2 } from "lucide-react"
import { type ComponentProps, useState } from "react"
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useCityProvider } from "@/providers/cityProvider"

function ReferralRow({
  referral,
  onRefresh,
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
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  const [deleteOpen, setDeleteOpen] = useState(false)

  const deleteMutation = useMutation({
    mutationFn: () => InvitesService.deleteMyLink({ linkId: referral.id }),
    onSuccess: () => {
      toast.success(t("referrals.delete_success"))
      setDeleteOpen(false)
      onRefresh()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        toast.error(t("referrals.delete_used_explanation"))
        setDeleteOpen(false)
        onRefresh()
        return
      }
      toast.error(t("referrals.delete_error"))
    },
  })

  const host = typeof window !== "undefined" ? window.location.host : ""
  const referralUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/r/${referral.token}`
      : `/r/${referral.token}`

  const handleCopy = () => {
    navigator.clipboard.writeText(referralUrl).then(() => {
      toast.success(t("referrals.link_copied"))
    })
  }

  // Only what the attendee needs to know before sharing: how much of the
  // link is left, and a discount or expiry when there is one.
  const discount = Number(referral.discount_percentage)
  const details = [
    referral.max_uses != null
      ? t("referrals.uses_of", {
          used: referral.current_uses,
          max: referral.max_uses,
        })
      : t("referrals.uses_count", { count: referral.current_uses }),
    discount > 0 &&
      t("referrals.preview_discount_value", { percent: discount }),
    referral.expires_at &&
      t("referrals.expires_on", {
        date: new Date(referral.expires_at).toLocaleDateString(),
      }),
  ].filter(Boolean)

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3 gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <p className="text-sm font-medium truncate">
            {host}/r/{referral.token}
            {referral.is_disabled && (
              <span className="ml-2 rounded bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                {t("referrals.disabled_badge")}
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">{details.join(" · ")}</p>
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
        {referral.current_uses > 0 ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex cursor-not-allowed">
                <Button
                  variant="ghost"
                  size="icon"
                  disabled
                  aria-label={t("referrals.delete_referral")}
                  aria-describedby={`delete-used-${referral.id}`}
                  className="pointer-events-none text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
                <span id={`delete-used-${referral.id}`} className="sr-only">
                  {t("referrals.delete_used_explanation")}
                </span>
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs">
              {t("referrals.delete_used_explanation")}
            </TooltipContent>
          </Tooltip>
        ) : (
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
        )}
      </div>
    </div>
  )
}

/**
 * One place a link can take people: an event, and the flow when the event
 * has several. Offers to create the link until there is one, then shows it.
 */
function DestinationRow({
  eventName,
  flowName,
  link,
  creating,
  disabled,
  onCreate,
  onRefresh,
}: {
  eventName: string
  flowName?: string | null
  link?: ComponentProps<typeof ReferralRow>["referral"] | null
  creating: boolean
  disabled: boolean
  onCreate: () => void
  onRefresh: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="min-w-0 text-base leading-snug sm:flex-1">
          <span
            className={
              flowName
                ? "font-medium text-muted-foreground"
                : "font-semibold text-foreground"
            }
          >
            {eventName}
          </span>
          {flowName && (
            <>
              {" "}
              <span
                className="mx-1 text-muted-foreground/60"
                aria-hidden="true"
              >
                ·
              </span>{" "}
              <span className="font-semibold text-foreground">{flowName}</span>
            </>
          )}
        </p>
        {!link && (
          <Button
            size="sm"
            variant="outline"
            className="self-end sm:self-auto"
            onClick={onCreate}
            disabled={disabled}
          >
            {creating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            {t("referrals.create_link")}
          </Button>
        )}
      </div>
      {link && <ReferralRow referral={link} onRefresh={onRefresh} />}
    </div>
  )
}

function apiErrorDetail(err: unknown): string | null {
  return err instanceof ApiError &&
    err.body &&
    typeof err.body === "object" &&
    typeof (err.body as { detail?: unknown }).detail === "string"
    ? (err.body as { detail: string }).detail
    : null
}

/**
 * Links into other popups of this tenant, shared from this one.
 *
 * The backend decides who may share and which popups accept these links, so
 * an empty answer (no targets, or someone who may not share) hides the
 * section entirely rather than explaining why. Where this section is all the
 * page has to offer, `emptyMessage` says so instead of leaving it blank.
 */
function CrossPopupReferrals({
  sourcePopupId,
  emptyMessage,
}: {
  sourcePopupId: string
  emptyMessage?: string
}) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const queryKey = ["referrals", "cross-targets", sourcePopupId]

  const { data: targets, isLoading } = useQuery({
    queryKey,
    queryFn: () => InvitesService.listCrossPopupTargets({ sourcePopupId }),
  })

  const createMutation = useMutation({
    mutationFn: (target: { popup_id: string; sales_flow_id: string }) =>
      InvitesService.createMyLink({
        requestBody: {
          popup_id: target.popup_id,
          source_popup_id: sourcePopupId,
          sales_flow_id: target.sales_flow_id,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey })
    },
    onError: (err) => {
      toast.error(apiErrorDetail(err) ?? t("referrals.create_error"))
    },
  })

  if (!targets?.length) {
    if (!emptyMessage || isLoading) return null
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <p className="text-sm text-muted-foreground">{emptyMessage}</p>
      </div>
    )
  }

  const flowsByPopup = new Map<string, number>()
  for (const target of targets) {
    flowsByPopup.set(
      target.popup_id,
      (flowsByPopup.get(target.popup_id) ?? 0) + 1,
    )
  }

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">
          {t("referrals.cross_title")}
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t("referrals.cross_description")}
        </p>
      </div>
      <div className="space-y-3">
        {targets.map((target) => (
          <DestinationRow
            key={target.sales_flow_id}
            eventName={target.name}
            flowName={
              (flowsByPopup.get(target.popup_id) ?? 0) > 1
                ? target.flow_name
                : null
            }
            link={target.link}
            creating={
              createMutation.isPending &&
              createMutation.variables?.sales_flow_id === target.sales_flow_id
            }
            disabled={createMutation.isPending}
            onCreate={() => createMutation.mutate(target)}
            onRefresh={() => queryClient.invalidateQueries({ queryKey })}
          />
        ))}
      </div>
    </section>
  )
}

const ReferralsPage = () => {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const city = getCity()
  const queryClient = useQueryClient()
  const { data: sharing, isLoading: sharingLoading } = useQuery({
    queryKey: ["referrals", "sharing", city?.id ?? ""],
    queryFn: () => InvitesService.getMySharingStatus({ popupId: city!.id }),
    enabled: !!city?.id,
  })
  const canShare = sharing?.can_share === true
  // A link into an ended popup can no longer be redeemed, so there the page
  // only shares links into the tenant's other events.
  const ended = city?.status === "ended"

  const { data, isLoading } = useQuery({
    queryKey: ["referrals", "mine", city?.id ?? ""],
    queryFn: () =>
      InvitesService.listMyLinks({ popupId: city!.id, limit: 100 }),
    enabled: !!city?.id && canShare && !ended,
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
      toast.error(apiErrorDetail(err) ?? t("referrals.create_error"))
    },
  })

  if (sharingLoading) {
    return (
      <div className="flex justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }
  if (!canShare) {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <p className="text-sm text-muted-foreground">
          {t("referrals.sharing_unavailable")}
        </p>
      </div>
    )
  }

  if (ended) {
    return (
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("referrals.title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t("referrals.ended_description")}
          </p>
        </div>
        {city?.id && (
          <CrossPopupReferrals
            sourcePopupId={city.id}
            emptyMessage={t("referrals.ended_no_targets")}
          />
        )}
      </div>
    )
  }

  const referrals = data?.results ?? []
  const refreshMine = () =>
    queryClient.invalidateQueries({
      queryKey: ["referrals", "mine", city?.id ?? ""],
    })
  // One link per destination flow. The way in this attendee can share is
  // the destination; a link of theirs into another flow of this popup is
  // still theirs to copy or delete, so it is listed under it.
  const ownLink = referrals.find(
    (ref) => ref.sales_flow_id === sharing?.sales_flow_id,
  )
  const otherLinks = referrals.filter((ref) => ref !== ownLink)

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("referrals.title")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("referrals.description")}
        </p>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          <DestinationRow
            eventName={city?.name ?? ""}
            flowName={sharing?.flow_name}
            link={ownLink}
            creating={createMutation.isPending}
            disabled={createMutation.isPending}
            onCreate={() => createMutation.mutate()}
            onRefresh={refreshMine}
          />
          {otherLinks.map((ref) => (
            <ReferralRow key={ref.id} referral={ref} onRefresh={refreshMine} />
          ))}
        </div>
      )}

      {city?.id && <CrossPopupReferrals sourcePopupId={city.id} />}
    </div>
  )
}

export default ReferralsPage
