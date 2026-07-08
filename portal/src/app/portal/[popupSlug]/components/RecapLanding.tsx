"use client"

import { ArrowRight, CalendarDays, Users } from "lucide-react"
import Link from "next/link"
import { useTranslation } from "react-i18next"
import type { PopupPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { useRecapStats } from "@/hooks/useRecapStats"

const formatDate = (value: string | null | undefined) => {
  if (!value) return ""
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: "numeric",
      })
}

export default function RecapLanding({ popup }: { popup: PopupPublic }) {
  const { t } = useTranslation()
  const popupId = popup.id ? String(popup.id) : null
  const { data: stats, isLoading } = useRecapStats(popupId)
  const directoryEnabled =
    popup.sale_type !== "direct" && (popup.show_attendee_directory ?? false)

  const renderStat = (value: number | undefined) => {
    if (isLoading) return "…"
    if (value == null) return "—"
    return value
  }

  return (
    <section className="container mx-auto">
      <div className="space-y-6 max-w-5xl p-6 mx-auto">
        <div className="space-y-3">
          <Badge variant="secondary">
            {t("recap.status_pill", { date: formatDate(popup.end_date) })}
          </Badge>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("recap.hero_heading", { popupName: popup.name })}
          </h1>
          <p className="text-sm text-muted-foreground">
            {t("recap.hero_subheading")}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-1">
              {t("recap.stats.events", {
                count: stats?.events_count ?? 0,
                defaultValue: "events",
              })}
            </p>
            <p className="text-3xl font-bold text-foreground">
              {renderStat(stats?.events_count)}
            </p>
          </Card>
          {directoryEnabled && (
            <Card className="p-6">
              <p className="text-sm text-muted-foreground mb-1">
                {t("recap.stats.attendees", {
                  count: stats?.attendees_count ?? 0,
                  defaultValue: "attendees",
                })}
              </p>
              <p className="text-3xl font-bold text-foreground">
                {renderStat(stats?.attendees_count)}
              </p>
            </Card>
          )}
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-1">
              {t("recap.stats.days", {
                count: stats?.days ?? 0,
                defaultValue: "days",
              })}
            </p>
            <p className="text-3xl font-bold text-foreground">
              {renderStat(stats?.days)}
            </p>
          </Card>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="p-6 flex flex-col gap-2">
            <div className="flex items-center gap-2 font-semibold">
              <CalendarDays className="size-5" />
              {t("recap.cta.events_title")}
            </div>
            <p className="text-sm text-muted-foreground">
              {t("recap.cta.events_description")}
            </p>
            <Button asChild size="sm" className="self-start mt-2">
              <Link href={`/portal/${popup.slug}/events`}>
                {t("recap.cta.events_action")} <ArrowRight className="size-4" />
              </Link>
            </Button>
          </Card>
          {directoryEnabled && (
            <Card className="p-6 flex flex-col gap-2">
              <div className="flex items-center gap-2 font-semibold">
                <Users className="size-5" />
                {t("recap.cta.directory_title")}
              </div>
              <p className="text-sm text-muted-foreground">
                {t("recap.cta.directory_description")}
              </p>
              <Button asChild size="sm" className="self-start mt-2">
                <Link href={`/portal/${popup.slug}/attendees`}>
                  {t("recap.cta.directory_action")}{" "}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
            </Card>
          )}
        </div>
      </div>
    </section>
  )
}
