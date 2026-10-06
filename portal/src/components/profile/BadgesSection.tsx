"use client"

import { Copy, RefreshCw } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { BadgeTile } from "@/components/badges/BadgeTile"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import useMyBadges from "@/hooks/useMyBadges"
import usePublicProfileSettings from "@/hooks/usePublicProfileSettings"

function PublicProfileLink() {
  const { t } = useTranslation()
  const { settings, setEnabled, regenerate } = usePublicProfileSettings()
  if (!settings) return null

  const origin = typeof window === "undefined" ? "" : window.location.origin
  const url = `${origin}/u/${settings.token}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(t("profile.badges.link_copied"))
    } catch {
      toast.error(t("profile.badges.link_copy_failed"))
    }
  }

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium">
            {t("profile.badges.link_title")}
          </p>
          <p className="text-sm text-muted-foreground">
            {t("profile.badges.link_description")}
          </p>
        </div>
        <Switch
          checked={settings.enabled}
          disabled={setEnabled.isPending}
          onCheckedChange={(enabled) => setEnabled.mutate(enabled)}
          aria-label={t("profile.badges.link_toggle")}
        />
      </div>
      {settings.enabled ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">
            {url}
          </code>
          <Button size="sm" variant="outline" onClick={copy}>
            <Copy className="mr-1 h-4 w-4" />
            {t("profile.badges.link_copy")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={regenerate.isPending}
            onClick={() => {
              if (window.confirm(t("profile.badges.link_reset_confirm"))) {
                regenerate.mutate()
              }
            }}
          >
            <RefreshCw className="mr-1 h-4 w-4" />
            {t("profile.badges.link_reset")}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("profile.badges.link_off")}
        </p>
      )}
    </div>
  )
}

/** Badges the person has collected, plus their public share link. */
export default function BadgesSection() {
  const { t } = useTranslation()
  const { badges, isLoading } = useMyBadges()

  return (
    <Card className="space-y-4 p-6">
      <div>
        <h2 className="text-lg font-semibold">{t("profile.badges.title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("profile.badges.subtitle")}
        </p>
      </div>

      {!isLoading && badges.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("profile.badges.empty")}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-6 sm:grid-cols-4 lg:grid-cols-6">
          {badges.map((entry) => (
            <BadgeTile
              key={entry.badge.id}
              name={entry.badge.name}
              imageUrl={entry.badge.image_url}
              count={entry.count}
              caption={entry.awards.find((a) => a.message)?.message}
            />
          ))}
        </div>
      )}

      <PublicProfileLink />
    </Card>
  )
}
