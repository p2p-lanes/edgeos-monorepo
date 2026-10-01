"use client"

import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"

/**
 * "Live" pill for an event that is happening right now.
 *
 * Deliberately quiet: a contained red-500 token, no motion, and no change to
 * the card it sits on. The list already carries a red NOW divider and the day
 * grid a red now-rule, and those are the loud, positional signals; the badge
 * only has to name the state on the card itself. Keeping the card chrome
 * untouched also leaves the amber "featured" border free to stack with it,
 * which a red card border could not do.
 *
 * Red comes from the same `red-500` family as the NOW divider so the two read
 * as one system. The text steps to `red-600`/`dark:red-400` because 500 on a
 * 10% tint is under contrast at 10px in light mode.
 */
export function LiveBadge({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide leading-none text-red-600 dark:text-red-400",
        className,
      )}
    >
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500"
        aria-hidden="true"
      />
      {t("events.list.live")}
    </span>
  )
}
