"use client"

import Image from "next/image"
import { useTranslation } from "react-i18next"
import { useTenant } from "@/providers/tenantProvider"

export default function ComingSoonPage() {
  const { t } = useTranslation()
  const { tenant } = useTenant()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-8 text-center">
        {tenant?.logo_url && (
          <div className="relative h-16 w-48">
            <Image
              src={tenant.logo_url}
              alt={tenant.name ?? "Logo"}
              className="object-contain"
              fill
              sizes="192px"
            />
          </div>
        )}

        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight">
            {t("comingSoon.title")}
          </h1>
          <p className="text-muted-foreground">{t("comingSoon.description")}</p>
        </div>
      </div>
    </div>
  )
}
