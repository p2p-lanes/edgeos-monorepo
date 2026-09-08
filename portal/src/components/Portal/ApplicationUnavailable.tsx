"use client"

import { useTranslation } from "react-i18next"

export function ApplicationUnavailable() {
  const { t } = useTranslation()

  return (
    <main className="container py-6 md:py-12 mb-8 px-8 md:px-12 text-foreground">
      <div className="text-center space-y-4">
        <h2 className="text-2xl font-bold">{t("application.unavailable")}</h2>
        <p className="text-heading-secondary">
          {t("application.unavailable_description")}
        </p>
      </div>
    </main>
  )
}
