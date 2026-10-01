import { Calendar1, MapPinned, Users } from "lucide-react"
import Image from "next/image"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { HumanProfileStats } from "@/client"
import { imageOptimization } from "@/lib/image-optimization"
import { useTenant } from "@/providers/tenantProvider"
import { Card } from "../ui/card"

interface StatsCardsProps {
  stats: HumanProfileStats | null
  isLoading: boolean
}

const avatarColors = [
  "bg-sky-700",
  "bg-orange-700",
  "bg-emerald-700",
  "bg-purple-700",
  "bg-amber-700",
]

const getInitials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "?"

const getAvatarColor = (id: string) => {
  const hash = [...id].reduce((value, char) => value + char.charCodeAt(0), 0)
  return avatarColors[hash % avatarColors.length]
}

type ProfileStatsPerson = NonNullable<
  HumanProfileStats["most_shared_attendees"]
>[number]

function ConnectionAvatar({
  person,
  showSharedEvents,
}: {
  person: ProfileStatsPerson
  showSharedEvents: boolean
}) {
  const { t, i18n } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const sharedEvents = person.shared_events ?? []
  const avatar = person.picture_url ? (
    <Image
      src={person.picture_url}
      alt=""
      fill
      sizes="40px"
      className="rounded-full object-cover"
      {...imageOptimization(person.picture_url)}
    />
  ) : (
    getInitials(person.name)
  )

  const avatarClass = `relative flex h-10 w-10 items-center justify-center overflow-hidden rounded-full text-sm font-semibold text-white ${getAvatarColor(person.human_id)}`

  if (!showSharedEvents || sharedEvents.length === 0) {
    return (
      <div aria-hidden="true" className={`relative mb-2 ${avatarClass}`}>
        {avatar}
      </div>
    )
  }

  const popoverId = `shared-events-${person.human_id}`

  return (
    <div className="group relative z-0 mb-2 flex flex-col items-center hover:z-20 focus-within:z-20">
      <button
        type="button"
        aria-label={t("profile.shared_events_with", { name: person.name })}
        aria-expanded={isOpen}
        aria-controls={popoverId}
        className={`${avatarClass} cursor-pointer ring-offset-2 transition hover:scale-105 hover:ring-2 hover:ring-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
        onClick={() => setIsOpen((open) => !open)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setIsOpen(false)
        }}
      >
        {avatar}
      </button>
      <div
        id={popoverId}
        role="tooltip"
        className={`absolute left-1/2 top-full z-50 mt-2 w-64 -translate-x-1/2 rounded-xl border border-border bg-popover p-3 text-left text-popover-foreground shadow-lg transition-opacity ${isOpen ? "visible pointer-events-auto opacity-100" : "invisible pointer-events-none opacity-0 group-hover:visible group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:visible group-focus-within:pointer-events-auto group-focus-within:opacity-100"}`}
      >
        <p className="mb-2 text-xs font-semibold">
          {t("profile.shared_events_with", { name: person.name })}
        </p>
        <ul className="max-h-56 space-y-2 overflow-y-auto">
          {sharedEvents.map((event) => (
            <li
              key={`${event.event_id}:${event.start_time}`}
              className="border-t border-border/70 pt-2 first:border-0 first:pt-0"
            >
              <p className="text-xs font-medium leading-snug">{event.title}</p>
              <p className="mt-0.5 text-[10px] text-muted-foreground">
                {new Intl.DateTimeFormat(i18n.language, {
                  dateStyle: "medium",
                  timeStyle: "short",
                  timeZone: event.timezone,
                }).format(new Date(event.start_time))}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function ConnectionsCard({
  title,
  people,
  isLoading,
  countLabel,
  emptyLabel,
  topFiveLabel,
  showSharedEvents = false,
}: {
  title: string
  people: HumanProfileStats["most_shared_attendees"]
  isLoading: boolean
  countLabel: (count: number) => string
  emptyLabel: string
  topFiveLabel: string
  showSharedEvents?: boolean
}) {
  const topPeople = (people ?? []).slice(0, 5)

  return (
    <Card className="rounded-2xl border-border/80 bg-card p-5 shadow-sm sm:p-6">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Users className="h-4 w-4 shrink-0 text-muted-foreground" />
          <h3 className="truncate text-sm font-semibold text-foreground">
            {title}
          </h3>
        </div>
        <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          {topFiveLabel}
        </span>
      </div>

      {topPeople.length ? (
        <ol className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
          {topPeople.map((person) => (
            <li
              key={person.human_id}
              className="flex min-w-0 flex-col items-center text-center"
            >
              <ConnectionAvatar
                person={person}
                showSharedEvents={showSharedEvents}
              />
              <span className="max-w-full truncate text-xs font-semibold text-foreground">
                {person.name}
              </span>
              <span className="mt-1 text-[11px] text-muted-foreground">
                {countLabel(person.event_count)}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-2 text-sm text-muted-foreground">
          {isLoading ? "…" : emptyLabel}
        </p>
      )}
    </Card>
  )
}

const StatsCards = ({ stats, isLoading }: StatsCardsProps) => {
  const { t } = useTranslation()
  const { tenant } = useTenant()
  const today = new Date()
  const pastPopups =
    stats?.popups.filter(
      (popup) => popup.end_date && new Date(popup.end_date) < today,
    ) ?? []
  const upcomingPopups =
    stats?.popups.filter(
      (popup) => popup.start_date && new Date(popup.start_date) > today,
    ).length ?? 0
  const popupsAttended = stats ? pastPopups.length : null
  const totalDays = stats?.total_days ?? null
  const hasHostedEvents = (stats?.events_hosted ?? 0) > 0
  const showHostedMetrics = isLoading || hasHostedEvents

  const renderValue = (value: number | null) => {
    if (isLoading) return "…"
    if (value === null) return "—"
    return value
  }

  return (
    <div className="space-y-6 mb-8">
      <div
        className={`grid grid-cols-1 gap-4 sm:grid-cols-2 ${showHostedMetrics ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}
      >
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                {t("profile.popups_attended")}
              </p>
              <p className="text-3xl font-bold text-foreground">
                {renderValue(popupsAttended)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("profile.upcoming_popups_count", { count: upcomingPopups })}
              </p>
            </div>
            <div className="w-12 h-12 bg-green-500/20 rounded-lg flex items-center justify-center">
              <MapPinned className="w-6 h-6 text-green-500" />
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                {t("profile.days_at_tenant", { tenant: tenant?.name })}
              </p>
              <p className="text-3xl font-bold text-foreground">
                {renderValue(totalDays)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t("profile.days_across_popups")}
              </p>
            </div>
            <div className="w-12 h-12 bg-blue-500/20 rounded-lg flex items-center justify-center">
              <Calendar1 className="w-6 h-6 text-blue-500" />
            </div>
          </div>
        </Card>
        <Card className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground mb-1">
                {t("profile.calendar_events_attended")}
              </p>
              <p className="text-3xl font-bold text-foreground">
                {renderValue(stats?.events_attended ?? null)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {stats?.top_event_theme
                  ? t("profile.top_event_theme", {
                      theme: stats.top_event_theme,
                    })
                  : t("profile.events_across_popups")}
              </p>
            </div>
            <Calendar1 className="w-6 h-6 text-primary" />
          </div>
        </Card>
        {showHostedMetrics && (
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  {t("profile.calendar_events_hosted")}
                </p>
                <p className="text-3xl font-bold text-foreground">
                  {renderValue(stats?.events_hosted ?? null)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("profile.hosted_people_count", {
                    count: stats?.hosted_attendees_count ?? 0,
                  })}
                </p>
              </div>
              <MapPinned className="w-6 h-6 text-primary" />
            </div>
          </Card>
        )}
      </div>

      <div
        className={`grid grid-cols-1 gap-6 ${showHostedMetrics ? "md:grid-cols-2" : "md:grid-cols-1"}`}
      >
        <ConnectionsCard
          title={t("profile.people_shared_most")}
          people={stats?.most_shared_attendees ?? []}
          isLoading={isLoading}
          countLabel={(count) => t("profile.shared_events_count", { count })}
          emptyLabel={t("profile.no_calendar_activity")}
          topFiveLabel={t("profile.top_five")}
          showSharedEvents
        />
        {showHostedMetrics && (
          <ConnectionsCard
            title={t("profile.people_attending_hosted_events")}
            people={stats?.most_active_attendees_of_hosted_events ?? []}
            isLoading={isLoading}
            countLabel={(count) => t("profile.hosted_events_count", { count })}
            emptyLabel={t("profile.no_calendar_activity")}
            topFiveLabel={t("profile.top_five")}
          />
        )}
      </div>
    </div>
  )
}
export default StatsCards
