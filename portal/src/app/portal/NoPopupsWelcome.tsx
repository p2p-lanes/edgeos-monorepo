"use client"

import { CalendarClock } from "lucide-react"
import Image from "next/image"
import { useTranslation } from "react-i18next"
import useGetProfile from "@/hooks/useGetProfile"
import { imageOptimization } from "@/lib/image-optimization"
import { useTenant } from "@/providers/tenantProvider"

/**
 * Portal home when the organization has no popup visible in the portal.
 * A calm, branded welcome instead of an error-looking card: whose portal this
 * is and what to expect.
 */
export default function NoPopupsWelcome() {
  const { t } = useTranslation()
  const { tenant } = useTenant()
  const { profile } = useGetProfile()
  const firstName = profile?.first_name?.trim()
  const orgName = tenant?.name ?? ""
  const brandImage = tenant?.logo_url || tenant?.icon_url

  return (
    <div className="flex min-h-full w-full items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-lg flex-col items-center text-center">
        {brandImage ? (
          // Wide box with object-contain: logos are usually wordmarks.
          <div className="relative mb-8 h-28 w-full max-w-[240px]">
            <Image
              src={brandImage}
              alt={orgName}
              fill
              sizes="240px"
              loading="eager"
              className="object-contain"
              {...imageOptimization(brandImage)}
            />
          </div>
        ) : (
          <div className="mb-8 flex size-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <CalendarClock className="size-8" aria-hidden="true" />
          </div>
        )}

        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          {firstName
            ? t("portal.no_popups_welcome_named", { name: firstName })
            : t("portal.no_popups_welcome")}
        </h1>
        <p className="mt-3 max-w-md text-base text-muted-foreground">
          {orgName
            ? t("portal.no_popups_description", { org: orgName })
            : t("portal.no_popups_description_generic")}
        </p>
      </div>
    </div>
  )
}
