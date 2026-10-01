"use client"

import { CheckCircle, Loader2, X } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { cn } from "@/lib/utils"

/**
 * Sizing presets. Every surface shows the same two controls at the same
 * height so the pair always reads as one status-plus-action group.
 *
 * - `default`: event detail page. Matches the default `Button` height on
 *   desktop (h-9) and shrinks to the compact height on mobile so the group
 *   still fits the reserved slot in the details card.
 * - `compact`: list and calendar rows.
 * - `mini`: day-grid chips, where only an icon fits for the cancel action.
 */
const SIZES = {
  default: {
    wrapper: "gap-1.5",
    control:
      "h-7 gap-1 rounded-md px-2 text-xs sm:h-9 sm:gap-1.5 sm:px-2.5 sm:text-sm",
    icon: "h-3 w-3 sm:h-4 sm:w-4",
  },
  compact: {
    wrapper: "gap-1",
    control: "h-7 gap-1 rounded-md px-2 text-xs",
    icon: "h-3 w-3",
  },
  mini: {
    wrapper: "gap-0.5",
    control: "h-5 gap-0.5 rounded px-1 text-[9px]",
    icon: "h-2.5 w-2.5",
  },
} as const

export type RsvpStatusActionSize = keyof typeof SIZES

interface RsvpStatusActionProps {
  /** Visual density for the surface this group renders on. */
  size?: RsvpStatusActionSize
  /**
   * Status wording. Defaults to "Going"; the detail page passes
   * "Checked in" once the attendee has checked in.
   */
  label?: string
  /**
   * Whether the cancel action is offered. False once the event ended or the
   * attendee already checked in, where only the status is meaningful.
   */
  showCancel?: boolean
  /** True while this row's register/cancel request is in flight. */
  isPending?: boolean
  /** Runs only after the attendee confirms in the dialog. */
  onCancelRsvp: () => void
  className?: string
}

/**
 * Confirmed-RSVP state: a non-interactive "Going" indicator paired with a
 * secondary destructive "Cancel RSVP" action that asks for confirmation
 * before it fires.
 *
 * The status is a `<span>`, never a button, so it is neither clickable nor
 * focusable. Cancelling always goes through the dialog, so a stray click on
 * a dense calendar chip can no longer drop an RSVP.
 */
export function RsvpStatusAction({
  size = "compact",
  label,
  showCancel = true,
  isPending = false,
  onCancelRsvp,
  className,
}: RsvpStatusActionProps) {
  const { t } = useTranslation()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const sz = SIZES[size]

  const statusLabel = label ?? (t("events.rsvp.going") as string)
  const cancelLabel = t("events.rsvp.cancel") as string
  // The day-grid chip is too narrow for the words, so the action degrades to
  // its icon there and keeps the wording as its accessible name.
  const cancelLabelVisible = size !== "mini"

  const handleConfirm = () => {
    if (isPending) return
    setConfirmOpen(false)
    onCancelRsvp()
  }

  return (
    // These groups sit inside clickable event cards and <Link> rows. Stopping
    // propagation here covers both the inline controls and the portalled
    // dialog, whose React events still bubble to this subtree, so neither can
    // navigate away to the event page.
    // biome-ignore lint/a11y/noStaticElementInteractions: not an interaction of its own; the handler only absorbs clicks (including the portalled dialog's, which still bubble through this React subtree) so the surrounding event-card link cannot navigate. The real controls below are a <span> and a <button>.
    <div
      // Wraps instead of overflowing: the detail page pins this into a
      // fixed-width slot, and the controls are nowrap, so a longer locale
      // (Spanish and Icelandic both run longer) would otherwise spill left
      // over the rows beneath it.
      className={cn(
        "inline-flex max-w-full flex-wrap items-center justify-end",
        sz.wrapper,
        className,
      )}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      onKeyDown={(e) => e.stopPropagation()}
    >
      <span
        className={cn(
          "inline-flex select-none items-center whitespace-nowrap border border-emerald-300 bg-emerald-50 font-medium text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-950/40 dark:text-emerald-300",
          sz.control,
        )}
      >
        <CheckCircle className={cn("shrink-0", sz.icon)} aria-hidden="true" />
        {statusLabel}
      </span>

      {showCancel && (
        <button
          type="button"
          disabled={isPending}
          aria-label={cancelLabelVisible ? undefined : cancelLabel}
          title={cancelLabelVisible ? undefined : cancelLabel}
          onClick={() => {
            if (isPending) return
            setConfirmOpen(true)
          }}
          className={cn(
            "inline-flex items-center whitespace-nowrap border border-destructive/30 bg-destructive/10 font-medium text-destructive transition-colors hover:border-destructive/50 hover:bg-destructive/20 disabled:cursor-not-allowed disabled:opacity-60 dark:border-destructive/40 dark:bg-destructive/20 dark:hover:bg-destructive/30",
            sz.control,
          )}
        >
          {isPending ? (
            <Loader2 className={cn("shrink-0 animate-spin", sz.icon)} />
          ) : (
            <X className={cn("shrink-0", sz.icon)} aria-hidden="true" />
          )}
          {cancelLabelVisible && cancelLabel}
        </button>
      )}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        {/* Radix's default focus handling is left alone on purpose. With
            hasCloseButton={false} the first tabbable node is the safe "keep"
            button, so an Enter left over from the trigger cannot confirm
            anyway, and preventing the auto-focus would strand focus on the
            now aria-hidden trigger instead of trapping it in the dialog. */}
        <DialogContent className="max-w-md rounded-lg" hasCloseButton={false}>
          <DialogHeader className="text-left">
            <DialogTitle>{t("events.rsvp.cancel_confirm_title")}</DialogTitle>
            <DialogDescription>
              {t("events.rsvp.cancel_confirm_body")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0 sm:space-x-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              {t("events.rsvp.cancel_confirm_keep")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={handleConfirm}
            >
              {t("events.rsvp.cancel_confirm_confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
