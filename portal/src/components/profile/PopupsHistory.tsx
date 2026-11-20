import { Calendar, Clock, MapPin } from "lucide-react"
import Image from "next/image"
import { useTranslation } from "react-i18next"
import type {
  ApplicationStatus,
  HumanProfileStatsPopup,
  PopupPublic,
} from "@/client"
import {
  compareOptionalDates,
  formatDateRange,
  toTimestamp,
} from "@/helpers/dates"
import { imageOptimization } from "@/lib/image-optimization"
import { cn } from "@/lib/utils"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { Card } from "../ui/card"

function PopupThumb({
  imageUrl,
  name,
  className,
}: {
  imageUrl?: string | null
  name: string
  className?: string
}) {
  if (imageUrl) {
    return (
      <div className={cn("relative overflow-hidden", className)}>
        <Image
          src={imageUrl}
          alt={name}
          fill
          sizes="(max-width: 768px) 100vw, 33vw"
          className="object-cover"
          {...imageOptimization(imageUrl)}
        />
      </div>
    )
  }
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-gradient-to-br from-neutral-200 to-neutral-300",
        className,
      )}
    >
      <span className="text-3xl font-bold text-neutral-400">
        {name?.charAt(0).toUpperCase() ?? "?"}
      </span>
    </div>
  )
}

const POPUP_HISTORY_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
}

interface PopupWithApplicationStatus {
  popup_name: string
  start_date: string | null
  end_date: string | null
  total_days: number
  location?: string | null
  image_url?: string | null
  application_status?: ApplicationStatus
  popup_status?: PopupPublic["status"]
}

const PopupsHistory = ({ popups }: { popups: HumanProfileStatsPopup[] }) => {
  const { t } = useTranslation()
  const { applications } = useApplication()
  const { getPopups } = useCityProvider()
  const allPopups = getPopups()

  const formatPopupDates = (
    startDate: string | null | undefined,
    endDate: string | null | undefined,
  ) => formatDateRange(startDate, endDate, POPUP_HISTORY_DATE_FORMAT)

  const _getPopupStatus = (startDate: string, endDate: string) => {
    const now = new Date()
    const start = new Date(startDate)
    const end = new Date(endDate)

    if (now > end) {
      return {
        label: t("status.completed"),
        className: "bg-green-100 text-green-800",
      }
    }
    if (now >= start && now <= end) {
      return {
        label: t("status.in_progress"),
        className: "bg-primary/20 text-blue-800",
      }
    }
    return {
      label: t("status.upcoming"),
      className: "bg-muted text-foreground",
    }
  }

  const getApplicationStatusBadge = (status?: string) => {
    switch (status) {
      case "accepted":
        return {
          label: t("status.application_approved"),
          className: "bg-green-100 text-green-800",
        }
      case "in review":
        return {
          label: t("status.application_submitted"),
          className: "bg-primary/20 text-blue-800",
        }
      case "withdrawn":
        return {
          label: t("status.withdrawn"),
          className: "bg-muted text-muted-foreground",
        }
      case "draft":
        return {
          label: t("status.application_draft"),
          className: "bg-muted text-foreground",
        }
      default:
        return {
          label: t("status.upcoming"),
          className: "bg-muted text-foreground",
        }
    }
  }

  // Filter applications where ALL attendees have NO products
  const applicationsWithoutProducts =
    applications?.filter((app) =>
      (app.attendees ?? []).every(
        (attendee) =>
          (attendee.products as any[] | undefined)?.length !== undefined,
      ),
    ) ?? []

  // Map applications to popup data for upcoming popups with application status
  const upcomingPopupsFromApplications = applicationsWithoutProducts
    .map((app) => {
      const popup = allPopups.find((p: PopupPublic) => p.id === app.popup_id)
      if (!popup) return null

      return {
        popup_name: popup.name,
        start_date: popup.start_date ?? null,
        end_date: popup.end_date ?? null,
        popup_status: popup.status,
        total_days: 0,
        // LEGACY: location removed from API – review for deletion
        location: null,
        image_url: popup.image_url,
        application_status: app.status,
      } as PopupWithApplicationStatus
    })
    .filter((p): p is PopupWithApplicationStatus => p !== null)
    // Only show upcoming events. A gathering without an end date has not
    // ended yet (dates TBA), unless the organizer explicitly ended it.
    .filter((popup) => {
      const endTime = toTimestamp(popup.end_date)
      if (endTime === null) return popup.popup_status !== "ended"
      return endTime > Date.now()
    })
    // Most recent first; gatherings without dates go last.
    .sort((a, b) => compareOptionalDates(a.start_date, b.start_date, "desc"))

  const pastPopups = popups
    .filter((popup) => {
      const endTime = toTimestamp(popup.end_date)
      return endTime !== null && endTime < Date.now()
    })
    .filter(
      (popup, index, self) =>
        index === self.findIndex((t) => t.popup_name === popup.popup_name),
    )
    .sort((a, b) => compareOptionalDates(a.start_date, b.start_date))

  return (
    <Card className="p-6">
      <div className="mb-4">
        <h2 className="text-xl font-semibold text-foreground">
          {t("profile.popups_title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("profile.popups_subtitle")}
        </p>
      </div>

      <div className="py-2">
        <div className="space-y-6">
          {popups.length === 0 &&
            upcomingPopupsFromApplications.length === 0 && (
              <div className="text-center text-muted-foreground p-4">
                {t("profile.no_events")}
              </div>
            )}
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-6 h-6 text-foreground" />
            <h4 className="text-md font-semibold text-foreground">
              {t("profile.upcoming_popups")}
            </h4>
          </div>
          <div className="space-y-4">
            {upcomingPopupsFromApplications.length === 0 && (
              <div className="text-center text-muted-foreground p-4">
                {t("profile.no_upcoming_events")}
              </div>
            )}
            {upcomingPopupsFromApplications.map((popup, _index) => (
              <div
                key={popup.popup_name}
                className="flex items-center gap-4 p-4 border border-[#e2e8f0] rounded-lg"
              >
                <PopupThumb
                  imageUrl={popup.image_url}
                  name={popup.popup_name}
                  className="w-[70px] h-[70px] rounded-lg"
                />
                <div className="flex-1">
                  <h5 className="text-xl font-semibold text-foreground mb-2">
                    {popup.popup_name}
                  </h5>
                  <div className="flex items-center gap-4 text-xs text-[#64748b]">
                    {popup.location && (
                      <div className="flex items-center gap-1">
                        <MapPin className="w-4 h-4 text-foreground" />
                        <span className="text-sm">
                          {popup.location?.charAt(0).toUpperCase() +
                            popup.location?.slice(1)}
                        </span>
                      </div>
                    )}

                    {formatPopupDates(popup.start_date, popup.end_date) && (
                      <div className="flex items-center gap-1">
                        <Calendar className="w-4 h-4 text-foreground" />
                        <span className="text-sm">
                          {formatPopupDates(popup.start_date, popup.end_date)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
                <div
                  className={`px-3 py-1 rounded text-xs font-medium ${getApplicationStatusBadge(popup.application_status).className}`}
                >
                  {getApplicationStatusBadge(popup.application_status).label}
                </div>
              </div>
            ))}
          </div>

          <div className="h-px w-full bg-muted" />

          <div>
            <div className="flex items-center gap-2 mb-4">
              <Clock className="w-6 h-6 text-foreground" />
              <h4 className="text-md font-semibold text-foreground">
                {t("profile.past_popups")}
              </h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {pastPopups.length === 0 && (
                <div className="text-center text-muted-foreground p-4 col-span-3">
                  {t("profile.no_past_events")}
                </div>
              )}
              {pastPopups.map((popup) => (
                <Card key={popup.popup_id} className="p-4">
                  <div className="relative mb-3">
                    <PopupThumb
                      imageUrl={popup.image_url}
                      name={popup.popup_name}
                      className="w-full max-h-[140px] aspect-video rounded-lg"
                    />
                  </div>
                  <div>
                    <h5 className="text-lg font-semibold text-foreground mb-2">
                      {popup.popup_name}
                    </h5>
                    <div className="space-y-2 text-xs text-[#64748b] mb-4">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-foreground" />
                        <span className="text-sm">{popup.location}</span>
                      </div>

                      {formatPopupDates(popup.start_date, popup.end_date) && (
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-foreground" />
                          <span className="text-sm">
                            {formatPopupDates(popup.start_date, popup.end_date)}
                          </span>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-foreground" />
                        <span className="text-sm">
                          {t("profile.days_attended", {
                            count: popup.total_days,
                          })}
                        </span>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}

export default PopupsHistory
