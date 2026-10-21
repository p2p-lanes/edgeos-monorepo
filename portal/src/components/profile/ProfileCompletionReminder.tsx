"use client"

import { useQuery } from "@tanstack/react-query"
import { UserRoundPen } from "lucide-react"
import Link from "next/link"
import { useTranslation } from "react-i18next"
import { HumansService } from "@/client"
import { Button } from "@/components/ui/button"
import useGetProfile from "@/hooks/useGetProfile"
import { useCityProvider } from "@/providers/cityProvider"

export default function ProfileCompletionReminder() {
  const { t } = useTranslation()
  const { profile, isLoading } = useGetProfile()
  const city = useCityProvider().getCity()
  const ticketQuery = useQuery({
    queryKey: ["humans", "me", "popups", city?.id, "has-active-ticket"],
    queryFn: () =>
      HumansService.hasCurrentHumanActiveTicket({ popupId: city!.id }),
    enabled: !!profile && !isLoading && !!city?.id,
    staleTime: 30_000,
  })

  if (
    isLoading ||
    ticketQuery.isLoading ||
    !profile ||
    !city?.id ||
    (profile.first_name?.trim() && profile.last_name?.trim()) ||
    ticketQuery.data !== true
  ) {
    return null
  }

  return (
    <div className="w-full px-4 pt-4">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3 rounded-lg border border-primary/15 bg-primary/5 p-3 sm:flex-nowrap sm:p-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-background text-primary">
          <UserRoundPen className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            {t("portal.complete_profile_title")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("portal.complete_profile_reminder")}
          </p>
        </div>
        <Button asChild size="sm" className="ml-auto shrink-0">
          <Link href="/portal/profile">
            {t("portal.complete_profile_action")}
          </Link>
        </Button>
      </div>
    </div>
  )
}
