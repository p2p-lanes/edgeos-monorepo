import { useMutation, useQueryClient } from "@tanstack/react-query"
import { ChevronDown, Info, RotateCcw, Type } from "lucide-react"
import { useCallback, useMemo, useState } from "react"
import { RgbaColorPicker } from "react-colorful"
import { PopupsService, type PopupUpdate } from "@/client"
import { Button } from "@/components/ui/button"
import { InlineSection } from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import useCustomToast from "@/hooks/useCustomToast"
import { cn } from "@/lib/utils"
import { createErrorHandler } from "@/utils"
import {
  type PreviewEvent,
  type PreviewTab,
  ThemePreview,
} from "./ThemePreview"
import { NEW_KEY_DEFAULTS } from "./ThemePreview/themeExpand"

interface ThemeConfig {
  colors?: Record<string, string>
  typography?: {
    font_base_size?: string
    font_heading_scale?: number
  }
  radius?: string
  border_radius?: string
}

interface ThemeConfigFormProps {
  popupId: string
  themeConfig: ThemeConfig | null | undefined
  readOnly?: boolean
  previewEvent?: PreviewEvent
}

const EMPTY_PREVIEW_EVENT: PreviewEvent = {
  name: "",
  tagline: null,
  location: null,
  start_date: null,
  end_date: null,
  express_checkout_background: null,
}

export function ThemeConfigForm({
  popupId,
  themeConfig,
  readOnly,
  previewEvent,
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
  const [borderRadius, setBorderRadius] = useState(
    themeConfig?.border_radius ?? "",
  )
  const [typographyExpanded, setTypographyExpanded] = useState(false)
  const [highlightedKeys, setHighlightedKeys] = useState<Set<string>>(
    () => new Set(),
  )
  const [previewTab, setPreviewTab] = useState<PreviewTab>("home")

  const updateMutation = useMutation({
    mutationFn: (data: PopupUpdate) =>
      PopupsService.updatePopup({ popupId, requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Theme updated successfully")
      queryClient.invalidateQueries({ queryKey: ["popups"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const handleColorChange = useCallback((key: string, value: string) => {
    setColors((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleResetColor = useCallback((key: string) => {
    setColors((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
  }, [])

  const handleModeChange = useCallback((mode: "light" | "dark") => {
    setColors((prev) => ({ ...prev, mode }))
  }, [])

  const handleHover = useCallback((keys: string[] | null) => {
    setHighlightedKeys(keys ? new Set(keys) : new Set())
  }, [])

  const handleResetAll = () => {
    setColors({})
    setFontBaseSize("")
    setFontHeadingScale("")
    setRadius("")
    setBorderRadius("")
  }

  const handleSave = () => {
    const hasColors = Object.keys(colors).length > 0
    const hasTypography = fontBaseSize || fontHeadingScale
    const hasRadius = !!radius
    const hasBorderRadius = !!borderRadius

    const config: ThemeConfig | null =
      hasColors || hasTypography || hasRadius || hasBorderRadius
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
            ...(hasBorderRadius && { border_radius: borderRadius }),
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
    radius !== (themeConfig?.radius ?? "") ||
    borderRadius !== (themeConfig?.border_radius ?? "")

  // Effective values = user override OR default.
  const effectiveColors = useMemo(() => {
    const merged: Record<string, string> = { ...NEW_KEY_DEFAULTS }
    for (const [k, v] of Object.entries(colors)) {
      if (v) merged[k] = v
    }
    return merged
  }, [colors])

  const mode: "light" | "dark" =
    (colors.mode as "light" | "dark") === "dark" ? "dark" : "light"

  return (
    <InlineSection title="Portal Theme">
      <div className="py-3 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6">
        <div className="space-y-4">
          <p className="text-xs text-muted-foreground">
            Pick a mode + brand colors. The portal derives every other surface
            (backgrounds, borders, hovers, text) automatically for consistent
            contrast. Hover a field to highlight where it applies in the
            preview.
          </p>

          {/* Mode toggle */}
          <div
            className="flex items-center justify-between rounded-md border bg-background px-3 py-2.5"
            onMouseEnter={() => handleHover(["mode"])}
            onMouseLeave={() => handleHover(null)}
          >
            <div className="flex flex-col">
              <Label className="text-sm font-medium">Mode</Label>
              <span className="text-[11px] text-muted-foreground">
                Light or dark neutrals as the canvas for your brand colors.
              </span>
            </div>
            <div className="flex items-center gap-1 rounded-md border p-0.5">
              {(["light", "dark"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => handleModeChange(m)}
                  disabled={readOnly}
                  className={cn(
                    "rounded px-3 py-1 text-xs font-medium transition-colors",
                    mode === m
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m === "light" ? "Light" : "Dark"}
                </button>
              ))}
            </div>
          </div>

          {/* Color fields */}
          <div className="rounded-md border bg-background p-1.5">
            <ColorField
              colorKey="primary_color"
              label="Primary"
              description="Brand color. Used for CTAs, active states, highlights and the sidebar active item."
              value={colors.primary_color ?? ""}
              defaultValue={NEW_KEY_DEFAULTS.primary_color}
              onChange={(v) => handleColorChange("primary_color", v)}
              onReset={() => handleResetColor("primary_color")}
              onHover={handleHover}
              isHighlighted={highlightedKeys.has("primary_color")}
              disabled={readOnly}
            />
            <ColorField
              colorKey="primary_foreground_color"
              label="Primary text"
              description="Text color on top of the primary color (usually white or black depending on contrast)."
              value={colors.primary_foreground_color ?? ""}
              defaultValue={NEW_KEY_DEFAULTS.primary_foreground_color}
              onChange={(v) => handleColorChange("primary_foreground_color", v)}
              onReset={() => handleResetColor("primary_foreground_color")}
              onHover={handleHover}
              isHighlighted={highlightedKeys.has("primary_foreground_color")}
              disabled={readOnly}
            />
            <ColorField
              colorKey="secondary_color"
              label="Secondary"
              description="Optional supporting brand color. Used for secondary buttons and badges. Leave empty for a neutral fallback."
              value={colors.secondary_color ?? ""}
              defaultValue=""
              onChange={(v) => handleColorChange("secondary_color", v)}
              onReset={() => handleResetColor("secondary_color")}
              onHover={handleHover}
              isHighlighted={highlightedKeys.has("secondary_color")}
              disabled={readOnly}
            />
            <ColorField
              colorKey="accent_color"
              label="Accent"
              description="Optional tint for hover states. Defaults to a subtle mix of primary and card background."
              value={colors.accent_color ?? ""}
              defaultValue=""
              onChange={(v) => handleColorChange("accent_color", v)}
              onReset={() => handleResetColor("accent_color")}
              onHover={handleHover}
              isHighlighted={highlightedKeys.has("accent_color")}
              disabled={readOnly}
            />
            <ColorField
              colorKey="checkout_navbar_bg"
              label="Checkout navbar"
              description="Optional background color for the sticky navbar in the checkout flow. Leave empty to use a translucent mix derived from the mode."
              value={colors.checkout_navbar_bg ?? ""}
              defaultValue=""
              onChange={(v) => handleColorChange("checkout_navbar_bg", v)}
              onReset={() => handleResetColor("checkout_navbar_bg")}
              onHover={handleHover}
              isHighlighted={highlightedKeys.has("checkout_navbar_bg")}
              disabled={readOnly}
            />
          </div>

          {/* Typography */}
          <TypographySection
            fontBaseSize={fontBaseSize}
            setFontBaseSize={setFontBaseSize}
            fontHeadingScale={fontHeadingScale}
            setFontHeadingScale={setFontHeadingScale}
            radius={radius}
            setRadius={setRadius}
            borderRadius={borderRadius}
            setBorderRadius={setBorderRadius}
            expanded={typographyExpanded}
            onToggle={() => setTypographyExpanded((v) => !v)}
            disabled={readOnly}
          />

          <Separator />

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
                Reset all
              </Button>
              <LoadingButton
                type="button"
                size="sm"
                onClick={handleSave}
                loading={updateMutation.isPending}
                disabled={!hasChanges}
              >
                Save theme
              </LoadingButton>
            </div>
          )}
        </div>

        <div className="hidden lg:block">
          <div className="sticky top-20">
            <ThemePreview
              colors={effectiveColors}
              fontBaseSize={fontBaseSize}
              fontHeadingScale={fontHeadingScale}
              radius={radius}
              borderRadius={borderRadius}
              highlightedKeys={highlightedKeys}
              activeTab={previewTab}
              onTabChange={setPreviewTab}
              previewEvent={previewEvent ?? EMPTY_PREVIEW_EVENT}
            />
          </div>
        </div>
      </div>
    </InlineSection>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// TypographySection — unchanged from the previous iteration. Handles font
// size, heading scale and radius. Collapsed by default since most admins
// won't touch it.
// ─────────────────────────────────────────────────────────────────────────────

interface TypographySectionProps {
  fontBaseSize: string
  setFontBaseSize: (v: string) => void
  fontHeadingScale: string
  setFontHeadingScale: (v: string) => void
  radius: string
  setRadius: (v: string) => void
  borderRadius: string
  setBorderRadius: (v: string) => void
  expanded: boolean
  onToggle: () => void
  disabled?: boolean
}

function TypographySection({
  fontBaseSize,
  setFontBaseSize,
  fontHeadingScale,
  setFontHeadingScale,
  radius,
  setRadius,
  borderRadius,
  setBorderRadius,
  expanded,
  onToggle,
  disabled,
}: TypographySectionProps) {
  const sampleSize = fontBaseSize || "16px"
  const sampleScale = Number.parseFloat(fontHeadingScale) || 1.6
  const sampleRadius = radius || "0.5rem"
  const sampleBorderRadius = borderRadius || "0.5rem"
  const activeCount = [
    fontBaseSize,
    fontHeadingScale,
    radius,
    borderRadius,
  ].filter(Boolean).length

  return (
    <div className="rounded-lg border bg-background">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
      >
        <div className="flex items-center gap-2">
          <Type className="h-4 w-4 text-muted-foreground" />
          <div className="flex flex-col">
            <span className="text-sm font-medium">Typography & radius</span>
            <span className="text-[11px] text-muted-foreground">
              Font sizes, heading scale and border radius.
            </span>
          </div>
          {activeCount > 0 && (
            <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-xs text-primary">
              {activeCount}
            </span>
          )}
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div className="space-y-3 border-t px-3 pb-3 pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-1 flex-col">
              <Label className="text-xs">Base font size</Label>
              <span className="text-[11px] text-muted-foreground">
                Size inherited by the whole portal (e.g. 16px).
              </span>
            </div>
            <div
              className="rounded border bg-muted/40 px-2 py-1 text-foreground"
              style={{ fontSize: sampleSize, lineHeight: 1.2 }}
            >
              Aa
            </div>
            <Input
              placeholder="16px"
              value={fontBaseSize}
              onChange={(e) => setFontBaseSize(e.target.value)}
              disabled={disabled}
              className="h-8 max-w-[110px] font-mono text-xs"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-1 flex-col">
              <Label className="text-xs">Heading scale</Label>
              <span className="text-[11px] text-muted-foreground">
                Multiplier applied to heading sizes (1–3).
              </span>
            </div>
            <div className="rounded border bg-muted/40 px-2 py-1">
              <div
                className="font-bold leading-tight text-foreground"
                style={{ fontSize: `calc(${sampleSize} * ${sampleScale})` }}
              >
                H
              </div>
            </div>
            <Input
              type="number"
              step="0.1"
              min="1"
              max="3"
              placeholder="1.5"
              value={fontHeadingScale}
              onChange={(e) => setFontHeadingScale(e.target.value)}
              disabled={disabled}
              className="h-8 max-w-[110px] font-mono text-xs"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-1 flex-col">
              <Label className="text-xs">Radius (buttons & inputs)</Label>
              <span className="text-[11px] text-muted-foreground">
                Border radius for buttons, inputs and small elements.
              </span>
            </div>
            <div
              className="h-7 w-10 border bg-primary/20"
              style={{ borderRadius: sampleRadius }}
            />
            <Input
              placeholder="0.5rem"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              disabled={disabled}
              className="h-8 max-w-[110px] font-mono text-xs"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-1 flex-col">
              <Label className="text-xs">Border radius (cards)</Label>
              <span className="text-[11px] text-muted-foreground">
                Border radius for cards and large containers.
              </span>
            </div>
            <div
              className="h-7 w-10 border bg-primary/20"
              style={{ borderRadius: sampleBorderRadius }}
            />
            <Input
              placeholder="0.5rem"
              value={borderRadius}
              onChange={(e) => setBorderRadius(e.target.value)}
              disabled={disabled}
              className="h-8 max-w-[110px] font-mono text-xs"
            />
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// ColorField — unchanged: hex input + RGBA picker + reset + hover highlight.
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedColor {
  hex: string
  alpha: number
  rgba: { r: number; g: number; b: number; a: number }
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16),
    g: Number.parseInt(hex.slice(3, 5), 16),
    b: Number.parseInt(hex.slice(5, 7), 16),
  }
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`
}

function parseColor(color: string): ParsedColor {
  if (!color)
    return { hex: "#000000", alpha: 1, rgba: { r: 0, g: 0, b: 0, a: 1 } }
  const rgbaMatch = color.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/,
  )
  if (rgbaMatch) {
    const r = Number.parseInt(rgbaMatch[1], 10)
    const g = Number.parseInt(rgbaMatch[2], 10)
    const b = Number.parseInt(rgbaMatch[3], 10)
    const a = rgbaMatch[4] !== undefined ? Number.parseFloat(rgbaMatch[4]) : 1
    return { hex: rgbToHex(r, g, b), alpha: a, rgba: { r, g, b, a } }
  }
  if (/^#[0-9a-fA-F]{8}$/.test(color)) {
    const a =
      Math.round((Number.parseInt(color.slice(7, 9), 16) / 255) * 100) / 100
    const { r, g, b } = hexToRgb(color.slice(0, 7))
    return { hex: color.slice(0, 7), alpha: a, rgba: { r, g, b, a } }
  }
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    const { r, g, b } = hexToRgb(color)
    return { hex: color, alpha: 1, rgba: { r, g, b, a: 1 } }
  }
  return { hex: "#000000", alpha: 1, rgba: { r: 0, g: 0, b: 0, a: 1 } }
}

function buildColorString(hex: string, alpha: number): string {
  if (alpha >= 1) return hex
  const r = Number.parseInt(hex.slice(1, 3), 16)
  const g = Number.parseInt(hex.slice(3, 5), 16)
  const b = Number.parseInt(hex.slice(5, 7), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

interface ColorFieldProps {
  colorKey: string
  label: string
  description: string
  value: string
  defaultValue: string
  onChange: (value: string) => void
  onReset: () => void
  onHover: (keys: string[] | null) => void
  isHighlighted: boolean
  disabled?: boolean
}

function ColorField({
  colorKey,
  label,
  description,
  value,
  defaultValue,
  onChange,
  onReset,
  onHover,
  isHighlighted,
  disabled,
}: ColorFieldProps) {
  const displayValue = value || defaultValue
  const isCustom = !!value
  const parsed = parseColor(displayValue)
  const [open, setOpen] = useState(false)

  const handleRgbaChange = useCallback(
    (rgba: { r: number; g: number; b: number; a: number }) => {
      const hex = rgbToHex(rgba.r, rgba.g, rgba.b)
      onChange(buildColorString(hex, rgba.a))
    },
    [onChange],
  )

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover feeds the preview highlight; the inner button + input are the real controls.
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors",
        isHighlighted && "bg-blue-50 dark:bg-blue-950/30",
      )}
      onMouseEnter={() => onHover([colorKey])}
      onFocus={() => onHover([colorKey])}
      onMouseLeave={() => onHover(null)}
      onBlur={() => onHover(null)}
    >
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <Label className="truncate text-xs text-foreground" title={label}>
          {label}
        </Label>
        {description && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="shrink-0 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
              >
                <Info className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px]">
              {description}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild disabled={disabled}>
            <button
              type="button"
              className="relative h-7 w-7 shrink-0 cursor-pointer rounded border"
              aria-label={`Pick color for ${label}`}
            >
              <div
                className="absolute inset-0.5 rounded"
                style={{
                  backgroundImage:
                    "repeating-conic-gradient(#d4d4d4 0% 25%, transparent 0% 50%)",
                  backgroundSize: "8px 8px",
                }}
              />
              <div
                className="absolute inset-0.5 rounded"
                style={{ backgroundColor: displayValue || "transparent" }}
              />
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3" align="end">
            <div className="flex flex-col gap-3">
              <RgbaColorPicker
                color={parsed.rgba}
                onChange={handleRgbaChange}
                style={{ width: "220px" }}
              />
              <div className="flex items-center gap-2">
                <Input
                  value={parsed.hex}
                  onChange={(e) => {
                    const hex = e.target.value
                    if (/^#[0-9a-fA-F]{6}$/.test(hex)) {
                      onChange(buildColorString(hex, parsed.alpha))
                    }
                  }}
                  className="h-7 flex-1 font-mono text-xs"
                  placeholder="#000000"
                  maxLength={7}
                />
                <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                  {Math.round(parsed.alpha * 100)}%
                </span>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <Input
          value={value}
          placeholder={defaultValue || "optional"}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={cn(
            "h-7 w-[120px] font-mono text-xs",
            !isCustom && "text-muted-foreground",
          )}
        />
        {isCustom && !disabled ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={onReset}
            title="Reset to default"
          >
            <RotateCcw className="h-3 w-3" />
          </Button>
        ) : (
          <div className="h-7 w-7 shrink-0" />
        )}
      </div>
    </div>
  )
}
