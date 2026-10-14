"use client"

import Link from "next/link"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import useGetProfile from "@/hooks/useGetProfile"

export default function ProfileCompletionReminder() {
  const { t } = useTranslation()
  const { profile, isLoading } = useGetProfile()

  if (
    isLoading ||
    !profile ||
    (profile.first_name?.trim() && profile.last_name?.trim())
  ) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b bg-muted px-4 py-3">
      <p className="text-sm">{t("portal.complete_profile_reminder")}</p>
      <Button asChild size="sm" variant="outline">
        <Link href="/portal/profile">
          {t("portal.complete_profile_action")}
        </Link>
      </Button>
    </div>
  )
}
