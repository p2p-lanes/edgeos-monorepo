"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Award, Check, CheckCircle2, Search } from "lucide-react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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

// Past this many badges the picker gets a search box.
const SEARCH_THRESHOLD = 9

function canPick(item: IssuableBadge) {
  return item.recipient_has_it !== true && item.remaining !== 0
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
  const [search, setSearch] = useState("")
  // Same list, now flagging the badges this attendee already holds. The
  // directory's copy shows meanwhile so the dialog opens instantly.
  const { data: options = issuable } = useQuery({
    queryKey: queryKeys.profile.issuableBadges(popupId, attendeeId),
    queryFn: () => BadgesService.listIssuableBadges({ popupId, attendeeId }),
    placeholderData: issuable,
    enabled: open,
  })
  const pickable = options.filter(canPick)
  // With a single badge to give there is nothing to choose: it's preselected.
  // A choice that stopped being pickable (they already have it) is dropped.
  const selectedId =
    badgeId && pickable.some((item) => item.badge.id === badgeId)
      ? badgeId
      : pickable.length === 1
        ? pickable[0].badge.id
        : null
  const searchable = options.length > SEARCH_THRESHOLD
  const query = search.trim().toLowerCase()
  const shown = options
    .filter((item) => !query || item.badge.name.toLowerCase().includes(query))
    // Badges you can give first, the rest after.
    .sort((a, b) => Number(canPick(b)) - Number(canPick(a)))

  const send = useMutation({
    mutationFn: () =>
      BadgesService.giveBadgeAsHuman({
        requestBody: {
          badge_id: selectedId as string,
          popup_id: popupId,
          attendee_id: attendeeId,
          message: message.trim() || null,
        },
      }),
    onSuccess: () => {
      toast.success(t("attendees.badges.sent", { name: recipientName }))
      setBadgeId(null)
      setMessage("")
      setSearch("")
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

        <div className="space-y-2">
          <div>
            <p className="text-sm font-medium">
              {t("attendees.badges.step_choose")}
            </p>
            <p className="text-xs text-muted-foreground">
              {pickable.length === 1
                ? t("attendees.badges.step_choose_single")
                : t("attendees.badges.step_choose_hint")}
            </p>
          </div>
          {searchable && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("attendees.badges.search_placeholder")}
                aria-label={t("attendees.badges.search_placeholder")}
                className="pl-9"
              />
            </div>
          )}
          <div
            className={cn(
              "grid grid-cols-2 content-start gap-3 overflow-y-auto p-1 sm:grid-cols-3",
              // A fixed height while searching, so filtering doesn't make the
              // dialog jump around under the pointer.
              searchable ? "h-[45vh]" : "max-h-[45vh]",
            )}
          >
            {shown.map((item) => {
              const held = item.recipient_has_it === true
              const disabled = !canPick(item)
              const selected = selectedId === item.badge.id
              return (
                <button
                  type="button"
                  aria-pressed={selected}
                  key={item.badge.id}
                  disabled={disabled}
                  onClick={() => setBadgeId(item.badge.id)}
                  className={cn(
                    "relative flex flex-col items-center gap-1 rounded-lg border p-3 text-center transition-colors",
                    selected
                      ? "border-primary bg-primary/5 ring-2 ring-primary"
                      : "hover:border-primary/40",
                    disabled && "cursor-not-allowed opacity-50",
                  )}
                >
                  {selected && (
                    <CheckCircle2
                      className="absolute right-2 top-2 h-5 w-5 fill-primary text-primary-foreground"
                      aria-hidden
                    />
                  )}
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
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    {held ? (
                      <>
                        <Check className="h-3 w-3" aria-hidden />
                        {t("attendees.badges.already_has")}
                      </>
                    ) : (
                      <AllowanceNote item={item} />
                    )}
                  </span>
                </button>
              )
            })}
            {shown.length === 0 && (
              <p className="col-span-full py-6 text-center text-sm text-muted-foreground">
                {t("attendees.badges.search_empty")}
              </p>
            )}
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="send-badge-message">
            {t("attendees.badges.step_message")}
          </Label>
          <Textarea
            id="send-badge-message"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder={t("attendees.badges.message_example")}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!selectedId || send.isPending}
            onClick={() => send.mutate()}
          >
            {selectedId
              ? t("attendees.badges.send")
              : t("attendees.badges.choose_first")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
