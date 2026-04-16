import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ChevronDown,
  CreditCard,
  Info,
  LayoutPanelTop,
  RotateCcw,
  Type,
} from "lucide-react"
import type * as React from "react"
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

// Defaults para los 9 campos editables. Mirror los defaults del portal.
// Reexportados desde el helper compartido para que portal y backoffice
// estén siempre sincronizados.
const DEFAULT_COLORS: Record<string, string> = NEW_KEY_DEFAULTS

interface ColorMeta {
  label: string
  description: string
}

const COLOR_LABELS: Record<string, ColorMeta> = {
  // ─ portal
  title_color: {
    label: "Title color",
    description:
      "Applies to all titles in the portal: home, pass section, card titles, etc.",
  },
  subtitle_color: {
    label: "Subtitle & body color",
    description:
      "Applies to subtitles, body text, descriptions, navigation and secondary text.",
  },
  button_color: {
    label: "Button color",
    description:
      "Background color of regular action buttons (not errors or alerts).",
  },
  title_button_color: {
    label: "Button text color",
    description: "Text / label color of regular buttons.",
  },
  primary_background_color: {
    label: "App background",
    description:
      "Background color of the whole app (behind cards and sections).",
  },
  sidebar_background_color: {
    label: "Sidebar background",
    description: "Background color of the navigation sidebar.",
  },
  card_background_color: {
    label: "Card background",
    description:
      "Background color of cards (home, passes, popovers). Titles and subtitles inside the card inherit the Title and Subtitle colors.",
  },
  border_color: {
    label: "Border color",
    description: "Color of general borders (cards, inputs, separators).",
  },
  sidebar_border_color: {
    label: "Sidebar border color",
    description: "Color of borders and separators inside the sidebar.",
  },
  // ─ checkout
  checkout_title_color: {
    label: "Title color",
    description:
      "Applies to card and section titles in the checkout (attendee name, pass name, etc.).",
  },
  checkout_watermark_color: {
    label: "Watermark color",
    description:
      "Large decorative text that appears behind each checkout step title (Passes, Details, etc.).",
  },
  checkout_subtitle_color: {
    label: "Subtitle & body color",
    description:
      "Pass descriptions, body text and subtitles inside the checkout.",
  },
  checkout_navbar_bg_color: {
    label: "Navbar background",
    description:
      "Background color of the sticky top navbar of the checkout (with translucent blur over the image).",
  },
  checkout_badge_bg_color: {
    label: "Step badge background",
    description:
      "Color of the badge / pill indicating the active step in the checkout navbar.",
  },
  checkout_badge_title_color: {
    label: "Badge text color",
    description: "Text color inside the navbar step badge.",
  },
  checkout_card_bg_color: {
    label: "Card background",
    description:
      "Background color of the checkout cards (passes, attendee, cart items).",
  },
  checkout_bottom_bar_bg_color: {
    label: "Bottom bar background",
    description:
      "Background color of the floating bottom bar showing the total and continue button.",
  },
  checkout_button_color: {
    label: "Button color",
    description:
      "Background color of the main checkout button (Continue, Pay) and the add-pass buttons.",
  },
  checkout_button_title_color: {
    label: "Button text color",
    description: "Text / label color of the checkout buttons.",
  },
  checkout_bottom_bar_text_color: {
    label: "Bottom bar text color",
    description:
      'All text inside the floating bottom bar: "Total" label, total amount, item counters, and the back button label.',
  },
}

// A subsection inside a main collapsible: title + description + list of
// color keys. Rendered inline (no toggle) — the top-level card is what
// collapses.
interface SubGroup {
  title: string
  description: string
  keys: string[]
}

// A top-level collapsible card grouping related subsections. One per tab of
// the preview (Portal, Checkout).
interface ThemeSection {
  id: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  subgroups: SubGroup[]
}

const THEME_SECTIONS: ThemeSection[] = [
  {
    id: "portal",
    title: "Portal",
    description: "Home, passes and general app colors.",
    icon: LayoutPanelTop,
    subgroups: [
      {
        title: "Text",
        description: "Title, subtitle and body text colors.",
        keys: ["title_color", "subtitle_color"],
      },
      {
        title: "Buttons",
        description: "Background and text color of regular buttons.",
        keys: ["button_color", "title_button_color"],
      },
      {
        title: "Backgrounds",
        description: "Main background, sidebar and cards.",
        keys: [
          "primary_background_color",
          "sidebar_background_color",
          "card_background_color",
        ],
      },
      {
        title: "Borders",
        description: "General border and sidebar border colors.",
        keys: ["border_color", "sidebar_border_color"],
      },
    ],
  },
  {
    id: "checkout",
    title: "Checkout",
    description: "Colors applied to the purchase flow.",
    icon: CreditCard,
    subgroups: [
      {
        title: "Text & watermark",
        description:
          "Card titles, subtitles, watermark behind headers and bottom bar text.",
        keys: [
          "checkout_title_color",
          "checkout_subtitle_color",
          "checkout_watermark_color",
          "checkout_bottom_bar_text_color",
        ],
      },
      {
        title: "Navbar & badge",
        description: "Sticky navbar background and active step badge.",
        keys: [
          "checkout_navbar_bg_color",
          "checkout_badge_bg_color",
          "checkout_badge_title_color",
        ],
      },
      {
        title: "Backgrounds",
        description: "Card backgrounds and the floating bottom bar.",
        keys: ["checkout_card_bg_color", "checkout_bottom_bar_bg_color"],
      },
      {
        title: "Buttons",
        description: "Checkout button background and text color.",
        keys: ["checkout_button_color", "checkout_button_title_color"],
      },
    ],
  },
]

function getMeta(key: string): ColorMeta {
  return (
    COLOR_LABELS[key] ?? {
      label: key,
      description: "",
    }
  )
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
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    () => new Set(["portal"]),
  )
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

  // Effective values shown in the preview = user override OR default.
  const effectiveColors = useMemo(() => {
    const merged: Record<string, string> = { ...DEFAULT_COLORS }
    for (const [k, v] of Object.entries(colors)) {
      if (v) merged[k] = v
    }
    return merged
  }, [colors])

  return (
    <InlineSection title="Portal Theme">
      {/*
        Two-column layout (lg+): form fields on the left, preview sticky on
        the right. We don't need an IntersectionObserver to show/hide the
        preview — `sticky` already pegs it to the viewport only while the
        Portal Theme section is in flow, and it scrolls away naturally when
        the user moves to other sections of the parent form.
      */}
      <div className="py-3 lg:grid lg:grid-cols-[minmax(0,1fr)_400px] lg:gap-6">
        <div className="space-y-3">
          <p className="text-xs text-muted-foreground">
            Customize the look of this event's portal and checkout. Hover over a
            field to highlight where it applies in the preview on the right.
          </p>

          {/* Top-level collapsibles: one per preview tab (Portal, Checkout).
              Subgroups render inline inside each, separated by small
              heading/description blocks. */}
          {THEME_SECTIONS.map((section) => (
            <ThemeSectionCard
              key={section.id}
              section={section}
              colors={colors}
              highlightedKeys={highlightedKeys}
              isExpanded={expandedSections.has(section.id)}
              onToggle={() => toggleSection(section.id)}
              onColorChange={handleColorChange}
              onReset={handleResetColor}
              onHover={handleHover}
              readOnly={readOnly}
            />
          ))}

          {/* Typography (applies to both portal and checkout). */}
          <TypographySection
            fontBaseSize={fontBaseSize}
            setFontBaseSize={setFontBaseSize}
            fontHeadingScale={fontHeadingScale}
            setFontHeadingScale={setFontHeadingScale}
            radius={radius}
            setRadius={setRadius}
            borderRadius={borderRadius}
            setBorderRadius={setBorderRadius}
            expanded={expandedSections.has("typography")}
            onToggle={() => toggleSection("typography")}
            disabled={readOnly}
          />

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

        {/* Right column: live preview, sticky while the section is in view.
            Hidden on <lg so the form stays single-column on mobile. */}
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

// ──────────────────────────────────────────────────────────────────────────
// ThemeSectionCard — top-level collapsible grouping multiple subgroups
// ──────────────────────────────────────────────────────────────────────────

interface ThemeSectionCardProps {
  section: ThemeSection
  colors: Record<string, string>
  highlightedKeys: Set<string>
  isExpanded: boolean
  onToggle: () => void
  onColorChange: (key: string, value: string) => void
  onReset: (key: string) => void
  onHover: (keys: string[] | null) => void
  readOnly?: boolean
}

function ThemeSectionCard({
  section,
  colors,
  highlightedKeys,
  isExpanded,
  onToggle,
  onColorChange,
  onReset,
  onHover,
  readOnly,
}: ThemeSectionCardProps) {
  const Icon = section.icon
  const allKeys = section.subgroups.flatMap((g) => g.keys)
  const activeCount = allKeys.filter((k) => colors[k]).length

  return (
    <div className="rounded-lg border bg-background">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <div className="flex flex-col">
            <span className="text-sm font-medium">{section.title}</span>
            <span className="text-[11px] text-muted-foreground">
              {section.description}
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
            isExpanded && "rotate-180",
          )}
        />
      </button>

      {isExpanded && (
        // biome-ignore lint/a11y/noStaticElementInteractions: hover handler clears the preview highlight; no keyboard equivalent needed since blur from each ColorField does the same
        <div
          className="space-y-5 border-t px-3 pb-4 pt-4"
          onMouseLeave={() => onHover(null)}
        >
          {section.subgroups.map((subgroup, i) => (
            <div key={subgroup.title} className="space-y-2">
              {i > 0 && <Separator className="mb-3" />}
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-foreground">
                  {subgroup.title}
                </h4>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {subgroup.description}
                </p>
              </div>
              <div className="grid gap-2">
                {subgroup.keys.map((key) => {
                  const meta = getMeta(key)
                  return (
                    <ColorField
                      key={key}
                      colorKey={key}
                      label={meta.label}
                      description={meta.description}
                      value={colors[key] ?? ""}
                      defaultValue={
                        NEW_KEY_DEFAULTS[
                          key as keyof typeof NEW_KEY_DEFAULTS
                        ] ?? "#000000"
                      }
                      onChange={(v) => onColorChange(key, v)}
                      onReset={() => onReset(key)}
                      onHover={onHover}
                      isHighlighted={highlightedKeys.has(key)}
                      disabled={readOnly}
                    />
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// TypographySection — typography + radius with live samples beside each input
// ──────────────────────────────────────────────────────────────────────────

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
          {/* Base font size */}
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

          {/* Heading scale */}
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

          {/* Radius (buttons / inputs) */}
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

          {/* Border radius (cards / containers) */}
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

// ──────────────────────────────────────────────────────────────────────────
// ColorField — single row with label, tooltip, swatch + popover picker, hex input
// ──────────────────────────────────────────────────────────────────────────

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
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer/focus handlers feed the live preview highlight; the row itself is not a control, the inner picker button + input are the actual interactive elements
    <div
      className={cn(
        "flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors",
        isHighlighted && "bg-blue-50 dark:bg-blue-950/30",
      )}
      onMouseEnter={() => onHover([colorKey])}
      onFocus={() => onHover([colorKey])}
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
                style={{ backgroundColor: displayValue }}
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
          placeholder={defaultValue}
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
