"use client"

import { useQuery } from "@tanstack/react-query"
import { Star } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { BadgesService } from "@/client"
import {
  type BadgeRecipient,
  SendBadgeDialog,
} from "@/components/badges/SendBadgeDialog"
import { Button } from "@/components/ui/button"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"

export type ProfileHandle = Omit<
  Extract<BadgeRecipient, { kind: "profile" }>,
  "kind"
>

interface GiveProfileBadgeProps {
  handle: ProfileHandle
  recipientName: string
}

/**
 * "Give a star" on someone's public profile, for signed-in visitors who hold
 * a badge they may give outside any popup. Renders nothing otherwise.
 */
export function GiveProfileBadge({
  handle,
  recipientName,
}: GiveProfileBadgeProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const isAuthenticated = useIsAuthenticated()
  const [open, setOpen] = useState(false)
  const { data: issuable = [] } = useQuery({
    queryKey: queryKeys.profile.profileIssuable(handle),
    queryFn: () =>
      BadgesService.listProfileIssuableBadges({
        username: handle.username,
        token: handle.token,
      }),
    enabled: isAuthenticated,
    // An expired session or a link that just stopped being shared simply
    // hides the button; the visitor stays on the page.
    retry: false,
    meta: { optionalAuth: true },
  })
  if (!isAuthenticated || issuable.length === 0) return null

  const label =
    issuable.length === 1
      ? t("publicProfile.give_named", { badge: issuable[0].badge.name })
      : t("publicProfile.give")

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Star aria-hidden="true" />
        {label}
      </Button>
      <SendBadgeDialog
        open={open}
        onOpenChange={setOpen}
        recipient={{ kind: "profile", ...handle }}
        recipientName={recipientName}
        issuable={issuable}
        // The badge grid and counts on this page are server-rendered.
        onSent={() => router.refresh()}
      />
    </>
  )
}
