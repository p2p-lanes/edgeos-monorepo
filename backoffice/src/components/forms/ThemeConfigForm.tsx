import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  ChevronDown,
  CreditCard,
  Info,
  Layers,
  LayoutPanelTop,
  MousePointerClick,
  PanelLeft,
  RotateCcw,
  ShieldAlert,
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
import { type PreviewTab, ThemePreview } from "./ThemePreview"

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

// Defaults for the 36 color tokens. Mirrors what the portal falls back to.
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
  heading: "#1a1a1a",
  heading_secondary: "#6b6b8a",
  body: "#1a1a1a",
  nav_text: "#1a1a1a",
  nav_text_secondary: "#6b6b8a",
  pass_title: "#1a1a1a",
  pass_text: "#6b6b8a",
  checkout_nav_bg: "#ffffff",
  checkout_nav_text: "#1a1a1a",
}

interface ColorMeta {
  label: string
  description: string
}

// Friendly Spanish labels + descriptions for each token. The label is what
// the user sees in the field row; the description appears in a hover tooltip
// to clarify exactly which UI element the color affects.
const COLOR_LABELS: Record<string, ColorMeta> = {
  background: {
    label: "Fondo de la página",
    description: "Color de fondo general del portal del evento.",
  },
  foreground: {
    label: "Texto general",
    description: "Color de texto base que se aplica sobre el fondo principal.",
  },
  heading: {
    label: "Título principal",
    description: "Color del título principal del hero (H1).",
  },
  heading_secondary: {
    label: "Subtítulos",
    description: "Color de subtítulos y títulos secundarios (H2, H3).",
  },
  body: {
    label: "Texto del cuerpo",
    description: "Color del texto largo / párrafos en la página principal.",
  },
  nav_text: {
    label: "Texto del menú",
    description: "Color de los enlaces del menú de navegación superior.",
  },
  nav_text_secondary: {
    label: "Texto secundario del menú",
    description: "Color de enlaces secundarios o subitems del menú.",
  },
  card: {
    label: "Fondo de la card",
    description:
      "Color de fondo de las cards de pases / tickets y otros bloques tipo card.",
  },
  card_foreground: {
    label: "Texto general de la card",
    description: "Color del texto base dentro de las cards.",
  },
  pass_title: {
    label: "Título del pase",
    description: "Color del nombre del pase dentro de la card del ticket.",
  },
  pass_text: {
    label: "Descripción del pase",
    description:
      "Color del texto descriptivo (precio secundario, detalles) del pase.",
  },
  popover: {
    label: "Fondo de popovers",
    description:
      "Color de fondo de selectores, dropdowns y menús flotantes (popovers).",
  },
  popover_foreground: {
    label: "Texto de popovers",
    description: "Color del texto dentro de selectores y dropdowns.",
  },
  primary: {
    label: "Botón primario — fondo",
    description:
      "Fondo del botón de acción principal (ej. 'Comprar', 'Confirmar').",
  },
  primary_foreground: {
    label: "Botón primario — texto",
    description: "Color del texto sobre el botón primario.",
  },
  secondary: {
    label: "Botón secundario — fondo",
    description: "Fondo de botones secundarios o de acciones alternativas.",
  },
  secondary_foreground: {
    label: "Botón secundario — texto",
    description: "Color del texto sobre el botón secundario.",
  },
  accent: {
    label: "Acentos / hover — fondo",
    description:
      "Color de acento usado en hover, badges activos y resaltados sutiles.",
  },
  accent_foreground: {
    label: "Acentos / hover — texto",
    description: "Color del texto sobre superficies de acento.",
  },
  ring: {
    label: "Outline de foco",
    description:
      "Anillo que aparece alrededor de inputs y botones cuando reciben foco (tab/click).",
  },
  checkout_nav_bg: {
    label: "Checkout — fondo del nav",
    description:
      "Color de fondo de la barra de navegación del flujo de checkout.",
  },
  checkout_nav_text: {
    label: "Checkout — texto del nav",
    description: "Color del texto y los pasos en la barra del checkout.",
  },
  muted: {
    label: "Fondo apagado",
    description:
      "Fondo para zonas secundarias, inputs deshabilitados y placeholders de imagen.",
  },
  muted_foreground: {
    label: "Texto apagado",
    description: "Color de texto secundario, hints y placeholders.",
  },
  destructive: {
    label: "Error / destructivo — fondo",
    description:
      "Color para errores, alertas críticas y acciones destructivas (eliminar).",
  },
  destructive_foreground: {
    label: "Error / destructivo — texto",
    description: "Color del texto sobre superficies de error.",
  },
  border: {
    label: "Bordes generales",
    description: "Color de los bordes que separan secciones, cards y bloques.",
  },
  input: {
    label: "Borde de inputs",
    description: "Color del borde de los campos de formulario.",
  },
  sidebar: {
    label: "Sidebar — fondo",
    description: "Fondo del panel lateral (sidebar) del admin embebido.",
  },
  sidebar_foreground: {
    label: "Sidebar — texto",
    description: "Color del texto base dentro del sidebar.",
  },
  sidebar_primary: {
    label: "Sidebar — item activo (fondo)",
    description: "Fondo del item seleccionado / activo en el sidebar.",
  },
  sidebar_primary_foreground: {
    label: "Sidebar — item activo (texto)",
    description: "Color del texto del item activo del sidebar.",
  },
  sidebar_accent: {
    label: "Sidebar — hover (fondo)",
    description: "Fondo del item del sidebar al hacer hover.",
  },
  sidebar_accent_foreground: {
    label: "Sidebar — hover (texto)",
    description: "Color del texto del item del sidebar al hacer hover.",
  },
  sidebar_border: {
    label: "Sidebar — bordes",
    description: "Color de los bordes y separadores dentro del sidebar.",
  },
  sidebar_ring: {
    label: "Sidebar — outline de foco",
    description: "Anillo de foco para elementos del sidebar.",
  },
}

interface VisualGroup {
  id: string
  title: string
  icon: React.ComponentType<{ className?: string }>
  description: string
  keys: string[]
}

// Groups organized by VISUAL AREA of the portal (not by CSS role).
// This is the main UX improvement: a user can think "I want to change
// the buttons" and find all button colors together.
const VISUAL_GROUPS: VisualGroup[] = [
  {
    id: "hero",
    title: "Hero / Página principal",
    icon: LayoutPanelTop,
    description: "Fondo, títulos y texto del cuerpo del landing.",
    keys: ["background", "foreground", "heading", "heading_secondary", "body"],
  },
  {
    id: "header",
    title: "Header & Navegación",
    icon: PanelLeft,
    description: "Enlaces del menú de navegación superior.",
    keys: ["nav_text", "nav_text_secondary"],
  },
  {
    id: "passes",
    title: "Pases (cards de tickets)",
    icon: CreditCard,
    description: "Cards de pases, popovers y selectores.",
    keys: [
      "card",
      "card_foreground",
      "pass_title",
      "pass_text",
      "popover",
      "popover_foreground",
    ],
  },
  {
    id: "actions",
    title: "Botones y acciones",
    icon: MousePointerClick,
    description: "Botones primarios, secundarios y estados de hover/foco.",
    keys: [
      "primary",
      "primary_foreground",
      "secondary",
      "secondary_foreground",
      "accent",
      "accent_foreground",
      "ring",
    ],
  },
  {
    id: "checkout",
    title: "Checkout",
    icon: Layers,
    description: "Barra de navegación del flujo de pago.",
    keys: ["checkout_nav_bg", "checkout_nav_text"],
  },
  {
    id: "states",
    title: "Estados, bordes y muted",
    icon: ShieldAlert,
    description: "Errores, textos apagados, bordes generales.",
    keys: [
      "muted",
      "muted_foreground",
      "destructive",
      "destructive_foreground",
      "border",
      "input",
    ],
  },
  {
    id: "sidebar",
    title: "Sidebar (panel admin)",
    icon: PanelLeft,
    description: "Colores del sidebar embebido del admin.",
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
    () => new Set(["hero"]),
  )
  const [highlightedKeys, setHighlightedKeys] = useState<Set<string>>(
    () => new Set(),
  )
  const [previewTab, setPreviewTab] = useState<PreviewTab>("landing")

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
            Personalizá el aspecto del portal de este evento. Pasá el mouse
            sobre un campo para resaltar dónde se aplica en el preview de la
            derecha.
          </p>

          {/* Color groups */}
          {VISUAL_GROUPS.map((group) => {
            const Icon = group.icon
            const isExpanded = expandedSections.has(group.id)
            const activeCount = group.keys.filter((k) => colors[k]).length

            return (
              <div key={group.id} className="rounded-lg border bg-background">
                <button
                  type="button"
                  onClick={() => toggleSection(group.id)}
                  className="flex w-full items-center justify-between px-3 py-2.5 text-left"
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">{group.title}</span>
                      <span className="text-[11px] text-muted-foreground">
                        {group.description}
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
                    className="border-t px-3 pb-3 pt-2"
                    onMouseLeave={() => handleHover(null)}
                  >
                    <div className="grid gap-2.5">
                      {group.keys.map((key) => {
                        const meta = getMeta(key)
                        return (
                          <ColorField
                            key={key}
                            colorKey={key}
                            label={meta.label}
                            description={meta.description}
                            value={colors[key] ?? ""}
                            defaultValue={DEFAULT_COLORS[key] ?? "#000000"}
                            onChange={(v) => handleColorChange(key, v)}
                            onReset={() => handleResetColor(key)}
                            onHover={handleHover}
                            isHighlighted={highlightedKeys.has(key)}
                            disabled={readOnly}
                          />
                        )
                      })}
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          {/* Typography */}
          <TypographySection
            fontBaseSize={fontBaseSize}
            setFontBaseSize={setFontBaseSize}
            fontHeadingScale={fontHeadingScale}
            setFontHeadingScale={setFontHeadingScale}
            radius={radius}
            setRadius={setRadius}
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
                Reset todo
              </Button>
              <LoadingButton
                type="button"
                size="sm"
                onClick={handleSave}
                loading={updateMutation.isPending}
                disabled={!hasChanges}
              >
                Guardar tema
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
              highlightedKeys={highlightedKeys}
              activeTab={previewTab}
              onTabChange={setPreviewTab}
            />
          </div>
        </div>
      </div>
    </InlineSection>
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
  expanded,
  onToggle,
  disabled,
}: TypographySectionProps) {
  const sampleSize = fontBaseSize || "16px"
  const sampleScale = Number.parseFloat(fontHeadingScale) || 1.6
  const sampleRadius = radius || "0.5rem"
  const activeCount = [fontBaseSize, fontHeadingScale, radius].filter(
    Boolean,
  ).length

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
            <span className="text-sm font-medium">Tipografía y radius</span>
            <span className="text-[11px] text-muted-foreground">
              Tamaños de fuente, escala de títulos y redondeo de bordes.
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
              <Label className="text-xs">Tamaño de fuente base</Label>
              <span className="text-[11px] text-muted-foreground">
                Tamaño que hereda todo el portal (ej. 16px).
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
              <Label className="text-xs">Escala de títulos</Label>
              <span className="text-[11px] text-muted-foreground">
                Multiplicador del tamaño de los títulos (1–3).
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

          {/* Radius */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex flex-1 flex-col">
              <Label className="text-xs">Border radius</Label>
              <span className="text-[11px] text-muted-foreground">
                Redondeo de bordes en cards, botones e inputs.
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
            title="Volver al default"
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
