"use client"

import { Copy, Link, Loader2, Share2 } from "lucide-react"
import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { BadgeTile } from "@/components/badges/BadgeTile"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useIsMobile } from "@/hooks/useIsMobile"
import useMyBadges from "@/hooks/useMyBadges"
import usePublicProfileSettings from "@/hooks/usePublicProfileSettings"

function PublicProfileLink() {
  const { t } = useTranslation()
  const { settings, setEnabled } = usePublicProfileSettings()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  if (!settings) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/u/${settings.token}`,
      )
      toast.success(t("profile.badges.link_copied"))
      setOpen(false)
    } catch {
      toast.error(t("profile.badges.link_copy_failed"))
    }
  }

  const changeSharing = (enabled: boolean) => {
    setEnabled.mutate(enabled, {
      onError: () => toast.error(t("profile.badges.link_update_failed")),
    })
  }

  const trigger = (
    <Button size="sm" variant="outline" className="shrink-0">
      <Share2 aria-hidden="true" />
      {t("profile.badges.share")}
    </Button>
  )
  const title = t("profile.badges.share_title")
  const description = t(
    settings.enabled
      ? "profile.badges.link_description"
      : "profile.badges.link_enable_description",
  )
  const actions = (
    <div className="space-y-1">
      <Button
        className="w-full"
        disabled={setEnabled.isPending}
        onClick={settings.enabled ? copy : () => changeSharing(true)}
      >
        {setEnabled.isPending ? (
          <Loader2
            aria-hidden="true"
            className="animate-spin motion-reduce:animate-none"
          />
        ) : settings.enabled ? (
          <Copy aria-hidden="true" />
        ) : (
          <Link aria-hidden="true" />
        )}
        {t(
          settings.enabled
            ? "profile.badges.link_copy"
            : "profile.badges.link_activate",
        )}
      </Button>
      {settings.enabled && (
        <Button
          variant="ghost"
          className="w-full text-muted-foreground"
          disabled={setEnabled.isPending}
          onClick={() => changeSharing(false)}
        >
          {t("profile.badges.link_deactivate")}
        </Button>
      )}
    </div>
  )

  if (isMobile) {
    return (
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>{trigger}</DialogTrigger>
        <DialogContent
          aria-modal="true"
          className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-sm overflow-y-auto rounded-xl bg-card p-5 text-card-foreground motion-reduce:animate-none"
        >
          <DialogHeader className="text-left">
            <DialogTitle className="pr-8">{title}</DialogTitle>
            <DialogDescription className="leading-relaxed">
              {description}
            </DialogDescription>
          </DialogHeader>
          {actions}
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-80 max-w-[calc(100vw-2rem)] space-y-4 rounded-xl p-5 motion-reduce:animate-none"
        aria-labelledby={`${panelId}-title`}
        aria-describedby={`${panelId}-description`}
      >
        <div className="space-y-2">
          <h3 id={`${panelId}-title`} className="text-sm font-semibold">
            {title}
          </h3>
          <p
            id={`${panelId}-description`}
            className="text-sm leading-relaxed text-muted-foreground"
          >
            {description}
          </p>
        </div>
        {actions}
      </PopoverContent>
    </Popover>
  )
}

/** Badges the person has collected, plus their public share link. */
export default function BadgesSection() {
  const { t } = useTranslation()
  const { badges, isLoading } = useMyBadges()

  return (
    <Card className="space-y-4 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3 border-b pb-4 sm:gap-6">
        <div className="min-w-0 space-y-1">
          <h2 className="text-lg font-semibold">{t("profile.badges.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("profile.badges.subtitle")}
          </p>
        </div>
        <PublicProfileLink />
      </div>

      {!isLoading && badges.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("profile.badges.empty")}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5">
          {badges.map((entry) => (
            <BadgeTile
              key={entry.badge.id}
              name={entry.badge.name}
              imageUrl={entry.badge.image_url}
              count={entry.count}
              category={entry.badge.category}
              description={entry.badge.description}
              awards={entry.awards}
            />
          ))}
        </div>
      )}
    </Card>
  )
}
