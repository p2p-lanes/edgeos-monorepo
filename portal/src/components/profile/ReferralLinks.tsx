"use client"

import { Check, Copy } from "lucide-react"
import { useState } from "react"
import type { GroupPublic, PopupPublic } from "@/client"
import { Button } from "@/components/ui/button"
import { getPublicGroupLink } from "@/lib/group-route"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { useTenant } from "@/providers/tenantProvider"
import useGetGroups from "../Sidebar/hooks/useGetGroups"
import { Card } from "../ui/card"

export default function ReferralLinks({
  referralCount,
}: {
  referralCount: number
}) {
  const { data: groups = [] } = useGetGroups()
  const { getPopups } = useCityProvider()
  const { applications } = useApplication()
  const { tenant } = useTenant()
  const popups = getPopups()
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const activeGroups = groups.filter((group: GroupPublic) => {
    const groupPopup = popups.find(
      (popup: PopupPublic) => popup.id === group.popup_id,
    )
    if (
      !groupPopup ||
      groupPopup.status !== "active" ||
      !group.is_ambassador_group
    ) {
      return false
    }

    const application = applications?.find(
      (app) => app.popup_id === groupPopup.id && app.status === "accepted",
    )
    if (!application) return false

    const hasProducts = (application.attendees ?? []).some(
      (attendee) => ((attendee.products as any[] | undefined) ?? []).length > 0,
    )
    return hasProducts
  })

  const copyToClipboard = (url: string, id: string) => {
    navigator.clipboard.writeText(url)
    setCopiedId(id)
    setTimeout(() => {
      setCopiedId(null)
    }, 2000)
  }

  return (
    <Card className="p-4 md:p-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between mb-6">
        <div className="flex flex-col gap-1 items-start justify-center">
          <h3 className="text-lg font-semibold text-foreground">
            Referral Links
          </h3>
          <p className="text-sm text-muted-foreground">
            Give your friends an auto-approval for upcoming {tenant?.name ?? ""}{" "}
            events
          </p>
        </div>
        <div className="flex gap-2 items-center mt-4 md:mt-0 md:items-end">
          <p className="text-xs text-muted-foreground mb-1">Total referrals</p>
          <p className="text-2xl font-bold text-foreground">{referralCount}</p>
        </div>
      </div>

      <div className="bg-muted rounded-lg p-3 md:p-4 space-y-3">
        {activeGroups.length === 0 ? (
          <div className="flex items-center justify-center p-4">
            <p className="text-sm text-muted-foreground text-center">
              You don’t have referral links for future pop-ups. Buy a ticket and
              get your referral link.
            </p>
          </div>
        ) : (
          activeGroups.map((group: GroupPublic) => {
            const groupPopup = popups.find(
              (popup: PopupPublic) => popup.id === group.popup_id,
            )

            if (!groupPopup) return null

            const link = getPublicGroupLink(window.location.origin, group.slug)

            return (
              <div
                key={group.id}
                className="flex flex-col md:flex-row items-start md:items-center gap-2 md:gap-4"
              >
                <div className="w-full md:w-40 flex-shrink-0">
                  {/* LEGACY: popup_name removed from API – review for deletion */}
                  <p className="text-sm text-foreground font-medium md:font-normal">
                    {groupPopup?.name}
                  </p>
                </div>
                <div className="flex-1 relative w-full">
                  <input
                    type="text"
                    value={link}
                    disabled
                    className="w-full px-3 py-2 pr-10 text-sm text-muted-foreground bg-card border border-border rounded-md cursor-default truncate"
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => copyToClipboard(link, group.id)}
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 hover:bg-muted"
                  >
                    {copiedId === group.id ? (
                      <Check className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <Copy className="w-4 h-4 text-muted-foreground" />
                    )}
                  </Button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </Card>
  )
}
