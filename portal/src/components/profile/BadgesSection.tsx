"use client"

import { Copy, Link, Loader2, Share2 } from "lucide-react"
import { useId, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ApiError, type PublicProfileSettings } from "@/client"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useIsMobile } from "@/hooks/useIsMobile"
import useMyBadges from "@/hooks/useMyBadges"
import usePublicProfileSettings from "@/hooks/usePublicProfileSettings"

/** The shareable URL: the readable alias when set, else the opaque token. */
function profileUrl(settings: PublicProfileSettings) {
  const path = settings.username
    ? `/${settings.username}`
    : `/u/${settings.token}`
  return `${window.location.origin}${path}`
}

function UsernameField({ settings }: { settings: PublicProfileSettings }) {
  const { t } = useTranslation()
  const { setUsername } = usePublicProfileSettings()
  const inputId = useId()
  const [draft, setDraft] = useState(settings.username ?? "")
  const [error, setError] = useState<string | null>(null)
  const value = draft.trim().toLowerCase()
  const changed = value !== (settings.username ?? "")

  const save = () => {
    setError(null)
    setUsername.mutate(value || null, {
      onSuccess: (saved) => {
        setDraft(saved.username ?? "")
        toast.success(t("profile.badges.username_saved"))
      },
      onError: (err) => {
        const status = err instanceof ApiError ? err.status : 0
        setError(
          t(
            status === 409
              ? "profile.badges.username_taken"
              : status === 422
                ? "profile.badges.username_invalid"
                : "profile.badges.link_update_failed",
          ),
        )
      },
    })
  }

  return (
    <form
      className="space-y-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        if (changed) save()
      }}
    >
      <Label htmlFor={inputId}>{t("profile.badges.username_label")}</Label>
      <div className="flex gap-2">
        <div className="flex min-w-0 flex-1 items-center rounded-md border bg-background pl-3 text-sm focus-within:ring-2 focus-within:ring-ring">
          <span className="shrink-0 text-muted-foreground">
            {window.location.host}/
          </span>
          <Input
            id={inputId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={30}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            placeholder={t("profile.badges.username_placeholder")}
            aria-invalid={error ? true : undefined}
            aria-describedby={`${inputId}-hint`}
            className="h-9 min-w-0 border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <Button
          type="submit"
          size="sm"
          variant="outline"
          className="h-9 shrink-0"
          disabled={!changed || setUsername.isPending}
        >
          {setUsername.isPending ? (
            <Loader2
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : null}
          {t("profile.badges.username_save")}
        </Button>
      </div>
      <p
        id={`${inputId}-hint`}
        className={
          error ? "text-xs text-destructive" : "text-xs text-muted-foreground"
        }
      >
        {error ?? t("profile.badges.username_hint")}
      </p>
    </form>
  )
}

function PublicProfileLink() {
  const { t } = useTranslation()
  const { settings, setEnabled } = usePublicProfileSettings()
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(false)
  const panelId = useId()
  if (!settings) return null

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(profileUrl(settings))
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
    <div className="space-y-3">
      {settings.enabled && <UsernameField settings={settings} />}
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
