"use client"

import { HelpCircle, Mail } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { useCityProvider } from "@/providers/cityProvider"
import { useTenant } from "@/providers/tenantProvider"

/**
 * Floating help button shown on every portal page. Opens a small popover that
 * lets the visitor email support. The destination is the tenant's configured
 * `sender_email`; when the tenant has no address the button is not rendered.
 * Must be mounted inside both `CityProvider` and `TenantProvider` (see
 * `Providers.tsx`).
 */
const HelpButton = () => {
  const { t } = useTranslation()
  const { tenant } = useTenant()
  const { getCity } = useCityProvider()

  const email = tenant?.sender_email?.trim()
  if (!email) {
    return null
  }

  const popup = getCity()
  const subject = popup?.name
    ? t("help.email_subject", { popup: popup.name })
    : t("help.email_subject_generic")
  const mailtoHref = `mailto:${email}?subject=${encodeURIComponent(subject)}`

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon"
          aria-label={t("help.aria_label")}
          className="fixed bottom-4 right-4 z-40 h-12 w-12 rounded-full shadow-lg [&_svg]:size-6"
        >
          <HelpCircle />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" side="top" className="w-72">
        <div className="space-y-3">
          <div className="space-y-1">
            <p className="text-sm font-semibold">{t("help.title")}</p>
            <p className="text-sm text-muted-foreground">
              {t("help.description")}
            </p>
          </div>
          <a
            href={mailtoHref}
            className={cn(buttonVariants({ variant: "default" }), "w-full")}
          >
            <Mail className="size-4" />
            {t("help.email_button")}
          </a>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default HelpButton
