"use client"

import { CheckCircle, Crown, Eye, EyeOff } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface RsvpedToggleProps {
  active: boolean
  onChange: (next: boolean) => void
  onMutuallyExclusive?: () => void
  showLabel?: boolean
  className?: string
}

export function RsvpedToggle({
  active,
  onChange,
  onMutuallyExclusive,
  showLabel = true,
  className,
}: RsvpedToggleProps) {
  const { t } = useTranslation()
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={() => {
        const next = !active
        onChange(next)
        if (next) onMutuallyExclusive?.()
      }}
      aria-pressed={active}
      aria-label={t("events.toolbar.my_rsvps")}
      title={t("events.toolbar.my_rsvps")}
      className={cn("px-2 sm:px-3", className)}
    >
      <CheckCircle className={cn("h-4 w-4", showLabel && "sm:mr-2")} />
      {showLabel && (
        <span className="hidden sm:inline">{t("events.toolbar.my_rsvps")}</span>
      )}
    </Button>
  )
}

interface MineToggleProps {
  active: boolean
  onChange: (next: boolean) => void
  onMutuallyExclusive?: () => void
  showLabel?: boolean
  className?: string
}

export function MineToggle({
  active,
  onChange,
  onMutuallyExclusive,
  showLabel = true,
  className,
}: MineToggleProps) {
  const { t } = useTranslation()
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={() => {
        const next = !active
        onChange(next)
        if (next) onMutuallyExclusive?.()
      }}
      aria-pressed={active}
      aria-label={t("events.toolbar.my_events")}
      title={t("events.toolbar.my_events")}
      className={cn("px-2 sm:px-3", className)}
    >
      <Crown className={cn("h-4 w-4", showLabel && "sm:mr-2")} />
      {showLabel && (
        <span className="hidden sm:inline">
          {t("events.toolbar.my_events")}
        </span>
      )}
    </Button>
  )
}

interface HiddenToggleProps {
  active: boolean
  onChange: (next: boolean) => void
  hiddenCount?: number
  showLabel?: boolean
  className?: string
}

export function HiddenToggle({
  active,
  onChange,
  hiddenCount,
  showLabel = true,
  className,
}: HiddenToggleProps) {
  const { t } = useTranslation()
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      onClick={() => onChange(!active)}
      aria-pressed={active}
      aria-label={t("events.toolbar.hidden")}
      title={
        active
          ? t("events.toolbar.hidden_title_showing")
          : t("events.toolbar.hidden_title_hidden")
      }
      disabled={!active && (hiddenCount ?? 0) === 0}
      className={cn("px-2 sm:px-3", className)}
    >
      {active ? (
        <EyeOff className={cn("h-4 w-4", showLabel && "sm:mr-2")} />
      ) : (
        <Eye className={cn("h-4 w-4", showLabel && "sm:mr-2")} />
      )}
      {showLabel && (
        <span className="hidden sm:inline">{t("events.toolbar.hidden")}</span>
      )}
      {typeof hiddenCount === "number" && hiddenCount > 0 && (
        <span className="ml-1 text-xs opacity-80">({hiddenCount})</span>
      )}
    </Button>
  )
}
