"use client"

import { ArrowLeft } from "lucide-react"
import Link from "next/link"
import { useTranslation } from "react-i18next"

interface FormHeaderProps {
  backHref: string
  cityName: string
  timezone: string
}

export function FormHeader({ backHref, cityName, timezone }: FormHeaderProps) {
  const { t } = useTranslation()

  return (
    <>
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {t("events.form.back_to_event")}
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight">
          {t("events.form.edit_heading")}
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          {timezone
            ? t("events.form.edit_subheading_with_tz", {
                cityName,
                timezone,
              })
            : t("events.form.edit_subheading", { cityName })}
        </p>
      </div>
    </>
  )
}
