import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ChevronDown,
  Layout,
  Palette,
  PanelLeft,
  RotateCcw,
  Square,
  Type,
} from "lucide-react"
import { useState } from "react"
import { PopupsService, type PopupUpdate } from "@/client"
import { Button } from "@/components/ui/button"
import { InlineSection } from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { Separator } from "@/components/ui/separator"
import useCustomToast from "@/hooks/useCustomToast"
import { cn } from "@/lib/utils"
import { createErrorHandler } from "@/utils"

interface ThemeConfig {
  colors?: Record<string, string>
  typography?: {
    font_base_size?: string
    font_heading_scale?: number
  }
  radius?: string
}

interface ThemeConfigFormProps {
  popupId: string
  themeConfig: ThemeConfig | null | undefined
  readOnly?: boolean
}

const DEFAULT_COLORS: Record<string, string> = {
  background: "#f5f5f5",
  foreground: "#1a1a1a",
  primary: "#2d3a6e",
  primary_foreground: "#f5f5ff",
  secondary: "#f0f0f5",
  secondary_foreground: "#2d3a6e",
  card: "#ffffff",
  card_foreground: "#333355",
  popover: "#ffffff",
  popover_foreground: "#333355",
  muted: "#f0f0f5",
  muted_foreground: "#6b6b8a",
  accent: "#f0f0f5",
  accent_foreground: "#2d3a6e",
  destructive: "#dc2626",
  destructive_foreground: "#f5f5ff",
  border: "#e5e5ee",
  input: "#e5e5ee",
  ring: "#333355",
  sidebar: "#fafafa",
  sidebar_foreground: "#555577",
  sidebar_primary: "#333355",
  sidebar_primary_foreground: "#fafafa",
  sidebar_accent: "#f0f0f5",
  sidebar_accent_foreground: "#333355",
  sidebar_border: "#e5e5ee",
  sidebar_ring: "#4f46e5",
}

const COLOR_SECTIONS = [
  {
    id: "general",
    title: "General",
    icon: Layout,
    keys: ["background", "foreground", "border", "input", "ring"],
  },
  {
    id: "primary",
    title: "Primary & Secondary",
    icon: Palette,
    keys: [
      "primary",
      "primary_foreground",
      "secondary",
      "secondary_foreground",
    ],
  },
  {
    id: "cards",
    title: "Cards & Popovers",
    icon: Square,
    keys: ["card", "card_foreground", "popover", "popover_foreground"],
  },
  {
    id: "accents",
    title: "Accents & States",
    icon: Palette,
    keys: [
      "accent",
      "accent_foreground",
      "muted",
      "muted_foreground",
      "destructive",
      "destructive_foreground",
    ],
  },
  {
    id: "sidebar",
    title: "Sidebar",
    icon: PanelLeft,
    keys: [
      "sidebar",
      "sidebar_foreground",
      "sidebar_primary",
      "sidebar_primary_foreground",
      "sidebar_accent",
      "sidebar_accent_foreground",
      "sidebar_border",
      "sidebar_ring",
    ],
  },
] as const

function formatColorLabel(key: string): string {
  return key
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

export function ThemeConfigForm({
  popupId,
  themeConfig,
  readOnly,
}: ThemeConfigFormProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [colors, setColors] = useState<Record<string, string>>(
    themeConfig?.colors ?? {},
  )
  const [fontBaseSize, setFontBaseSize] = useState(
    themeConfig?.typography?.font_base_size ?? "",
  )
  const [fontHeadingScale, setFontHeadingScale] = useState(
    themeConfig?.typography?.font_heading_scale?.toString() ?? "",
  )
  const [radius, setRadius] = useState(themeConfig?.radius ?? "")
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(),
  )

  const updateMutation = useMutation({
    mutationFn: (data: PopupUpdate) =>
      PopupsService.updatePopup({ popupId, requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Theme updated successfully")
      queryClient.invalidateQueries({ queryKey: ["popups"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const toggleSection = (sectionId: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev)
      if (next.has(sectionId)) {
        next.delete(sectionId)
      } else {
        next.add(sectionId)
      }
      return next
    })
  }

  const handleColorChange = (key: string, value: string) => {
    setColors((prev) => ({ ...prev, [key]: value }))
  }

  const handleResetColor = (key: string) => {
    setColors((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }

  const handleResetAll = () => {
    setColors({})
    setFontBaseSize("")
    setFontHeadingScale("")
    setRadius("")
  }

  const handleSave = () => {
    const hasColors = Object.keys(colors).length > 0
    const hasTypography = fontBaseSize || fontHeadingScale
    const hasRadius = !!radius

    const config: ThemeConfig | null =
      hasColors || hasTypography || hasRadius
        ? {
            ...(hasColors && { colors }),
            ...(hasTypography && {
              typography: {
                ...(fontBaseSize && { font_base_size: fontBaseSize }),
                ...(fontHeadingScale && {
                  font_heading_scale: Number.parseFloat(fontHeadingScale),
                }),
              },
            }),
            ...(hasRadius && { radius }),
          }
        : null

    updateMutation.mutate({
      theme_config: config as Record<string, unknown> | null,
    })
  }

  const hasChanges =
    JSON.stringify(colors) !== JSON.stringify(themeConfig?.colors ?? {}) ||
    fontBaseSize !== (themeConfig?.typography?.font_base_size ?? "") ||
    fontHeadingScale !==
      (themeConfig?.typography?.font_heading_scale?.toString() ?? "") ||
    radius !== (themeConfig?.radius ?? "")

  return (
    <InlineSection title="Portal Theme">
      <div className="space-y-3 py-3">
        <p className="text-xs text-muted-foreground">
          Customize the portal appearance for this event. Leave fields empty to
          use defaults.
        </p>

        {/* Color Sections */}
        {COLOR_SECTIONS.map((section) => {
          const Icon = section.icon
          const isExpanded = expandedSections.has(section.id)
          const activeCount = section.keys.filter((k) => colors[k]).length

          return (
            <div key={section.id} className="rounded-lg border">
              <button
                type="button"
                onClick={() => toggleSection(section.id)}
                className="flex w-full items-center justify-between px-3 py-2.5 text-left"
              >
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium">{section.title}</span>
                  {activeCount > 0 && (
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                      {activeCount}
                    </span>
                  )}
                </div>
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    isExpanded && "rotate-180",
                  )}
                />
              </button>

              {isExpanded && (
                <div className="border-t px-3 pb-3 pt-2">
                  <div className="grid gap-3">
                    {section.keys.map((key) => (
                      <ColorField
                        key={key}
                        label={formatColorLabel(key)}
                        value={colors[key] ?? ""}
                        defaultValue={DEFAULT_COLORS[key] ?? "#000000"}
                        onChange={(v) => handleColorChange(key, v)}
                        onReset={() => handleResetColor(key)}
                        disabled={readOnly}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* Typography */}
        <div className="rounded-lg border">
          <button
            type="button"
            onClick={() => toggleSection("typography")}
            className="flex w-full items-center justify-between px-3 py-2.5 text-left"
          >
            <div className="flex items-center gap-2">
              <Type className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Typography & Radius</span>
              {(fontBaseSize || fontHeadingScale || radius) && (
                <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
                  {
                    [fontBaseSize, fontHeadingScale, radius].filter(Boolean)
                      .length
                  }
                </span>
              )}
            </div>
            <ChevronDown
              className={cn(
                "h-4 w-4 text-muted-foreground transition-transform",
                expandedSections.has("typography") && "rotate-180",
              )}
            />
          </button>

          {expandedSections.has("typography") && (
            <div className="border-t px-3 pb-3 pt-2 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">
                  Base Font Size
                </Label>
                <Input
                  placeholder="16px"
                  value={fontBaseSize}
                  onChange={(e) => setFontBaseSize(e.target.value)}
                  disabled={readOnly}
                  className="max-w-[120px] text-sm"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">
                  Heading Scale
                </Label>
                <Input
                  type="number"
                  step="0.1"
                  min="1"
                  max="3"
                  placeholder="1.5"
                  value={fontHeadingScale}
                  onChange={(e) => setFontHeadingScale(e.target.value)}
                  disabled={readOnly}
                  className="max-w-[120px] text-sm"
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">
                  Border Radius
                </Label>
                <Input
                  placeholder="0.5rem"
                  value={radius}
                  onChange={(e) => setRadius(e.target.value)}
                  disabled={readOnly}
                  className="max-w-[120px] text-sm"
                />
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* Actions */}
        {!readOnly && (
          <div className="flex items-center justify-between">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleResetAll}
              className="text-muted-foreground"
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Reset All
            </Button>
            <LoadingButton
              type="button"
              size="sm"
              onClick={handleSave}
              loading={updateMutation.isPending}
              disabled={!hasChanges}
            >
              Save Theme
            </LoadingButton>
          </div>
        )}
      </div>
    </InlineSection>
  )
}

function ColorField({
  label,
  value,
  defaultValue,
  onChange,
  onReset,
  disabled,
}: {
  label: string
  value: string
  defaultValue: string
  onChange: (value: string) => void
  onReset: () => void
  disabled?: boolean
}) {
  const displayValue = value || defaultValue
  const isCustom = !!value

  return (
    <div className="flex items-center gap-2">
      <Label className="min-w-[130px] text-xs text-muted-foreground">
        {label}
      </Label>
      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={displayValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className="h-8 w-8 shrink-0 cursor-pointer rounded border bg-transparent p-0.5"
        />
        <Input
          value={value}
          placeholder={defaultValue}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            "h-8 w-[100px] font-mono text-xs",
            !isCustom && "text-muted-foreground",
          )}
        />
        {isCustom && !disabled && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onClick={onReset}
            title="Reset to default"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        )}
      </div>
    </div>
  )
}
