"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Award } from "lucide-react"
import Image from "next/image"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ApiError, BadgesService, type IssuableBadge } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { imageOptimization } from "@/lib/image-optimization"
import { queryKeys } from "@/lib/query-keys"
import { cn } from "@/lib/utils"

interface SendBadgeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  popupId: string
  attendeeId: string
  recipientName: string
  issuable: IssuableBadge[]
}

function AllowanceNote({ item }: { item: IssuableBadge }) {
  const { t, i18n } = useTranslation()
  if (item.remaining == null) {
    return <>{t("attendees.badges.unlimited")}</>
  }
  if (item.remaining > 0) {
    return <>{t("attendees.badges.remaining", { count: item.remaining })}</>
  }
  if (!item.resets_at) return <>{t("attendees.badges.none_left")}</>
  const when = new Date(item.resets_at).toLocaleString(i18n.language, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  })
  return <>{t("attendees.badges.back_at", { when })}</>
}

/** Pick one of your giveable badges and send it to an attendee. */
export function SendBadgeDialog({
  open,
  onOpenChange,
  popupId,
  attendeeId,
  recipientName,
  issuable,
}: SendBadgeDialogProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [badgeId, setBadgeId] = useState<string | null>(null)
  const [message, setMessage] = useState("")

  const send = useMutation({
    mutationFn: () =>
      BadgesService.giveBadgeAsHuman({
        requestBody: {
          badge_id: badgeId as string,
          popup_id: popupId,
          attendee_id: attendeeId,
          message: message.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success(t("attendees.badges.sent", { name: recipientName }))
      setBadgeId(null)
      setMessage("")
      onOpenChange(false)
    },
    onError: (error) => {
      const status = error instanceof ApiError ? error.status : 0
      toast.error(
        status === 429
          ? t("attendees.badges.error_exhausted")
          : status === 403
            ? t("attendees.badges.error_forbidden")
            : t("attendees.badges.error_generic"),
      )
    },
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.profile.issuableBadges(popupId),
      }),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {t("attendees.badges.dialog_title", { name: recipientName })}
          </DialogTitle>
          <DialogDescription>
            {t("attendees.badges.dialog_description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {issuable.map((item) => {
            const disabled = item.remaining === 0
            const selected = badgeId === item.badge.id
            return (
              <button
                type="button"
                key={item.badge.id}
                disabled={disabled}
                onClick={() => setBadgeId(item.badge.id)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition-colors",
                  selected
                    ? "border-primary bg-primary/5"
                    : "hover:border-primary/40",
                  disabled && "cursor-not-allowed opacity-50",
                )}
              >
                <span className="relative h-14 w-14">
                  {item.badge.image_url ? (
                    <Image
                      src={item.badge.image_url}
                      alt=""
                      fill
                      sizes="56px"
                      className="object-contain"
                      {...imageOptimization(item.badge.image_url)}
                    />
                  ) : (
                    <Award className="h-full w-full text-muted-foreground" />
                  )}
                </span>
                <span className="text-sm font-medium leading-tight">
                  {item.badge.name}
                </span>
                <span className="text-xs text-muted-foreground">
                  <AllowanceNote item={item} />
                </span>
              </button>
            )
          })}
        </div>

        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder={t("attendees.badges.message_placeholder")}
          aria-label={t("attendees.badges.message_placeholder")}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!badgeId || send.isPending}
            onClick={() => send.mutate()}
          >
            {t("attendees.badges.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
