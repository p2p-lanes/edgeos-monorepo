import { Check, DollarSign, GripVertical, Plus, Trash2 } from "lucide-react"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import type { TemplateConfigProps } from "./types"

const PATRON_VARIANTS = [
  {
    value: "default",
    label: "Default",
    description: "Preset buttons in a row with custom input",
  },
  {
    value: "compact",
    label: "Compact",
    description: "Condensed minimal layout",
  },
  {
    value: "grid",
    label: "Grid",
    description: "Large amount cards in a grid",
  },
] as const

function DefaultPreview() {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex-1 h-3 rounded bg-muted-foreground/15 flex items-center justify-center"
          >
            <div className="h-0.5 w-3 rounded-full bg-muted-foreground/25" />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <div className="h-0.5 w-4 rounded-full bg-muted-foreground/15" />
        <div className="flex-1 h-2.5 rounded border border-muted-foreground/15" />
      </div>
    </div>
  )
}

function CompactPreview() {
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex-1 h-2 rounded-sm bg-muted-foreground/10 flex items-center justify-center"
          >
            <div className="h-0.5 w-2 rounded-full bg-muted-foreground/20" />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-0.5">
        <div className="flex-1 h-2 rounded-sm border border-muted-foreground/10" />
      </div>
    </div>
  )
}

function GridPreview() {
  return (
    <div className="grid grid-cols-2 gap-1 w-full">
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex flex-col items-center justify-center rounded border border-muted-foreground/10 p-1"
        >
          <div className="h-1 w-4 rounded-full bg-muted-foreground/25" />
          <div className="h-0.5 w-3 rounded-full bg-muted-foreground/10 mt-0.5" />
        </div>
      ))}
    </div>
  )
}

const PREVIEW_MAP: Record<string, React.FC> = {
  default: DefaultPreview,
  compact: CompactPreview,
  grid: GridPreview,
}

interface PatronPresetConfigData {
  presets: number[]
  allow_custom: boolean
  minimum: number
}

const DEFAULTS: PatronPresetConfigData = {
  presets: [2500, 5000, 7500],
  allow_custom: true,
  minimum: 1000,
}

function parseConfig(
  config: Record<string, unknown> | null,
): PatronPresetConfigData {
  if (!config) return { ...DEFAULTS }
  return {
    presets: Array.isArray(config.presets)
      ? (config.presets as number[]).filter(
          (v) => typeof v === "number" && v > 0,
        )
      : [...DEFAULTS.presets],
    allow_custom:
      typeof config.allow_custom === "boolean"
        ? config.allow_custom
        : DEFAULTS.allow_custom,
    minimum:
      typeof config.minimum === "number" && config.minimum > 0
        ? config.minimum
        : DEFAULTS.minimum,
  }
}

function formatAmount(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents)
}

export function PatronPresetConfig({ config, onChange }: TemplateConfigProps) {
  const parsed = parseConfig(config)
  const variant = (config?.variant as string) || "default"
  const [newAmount, setNewAmount] = useState("")

  const emit = (updates: Partial<PatronPresetConfigData>) => {
    onChange({ ...config, ...parsed, ...updates })
  }

  const handleAddPreset = () => {
    const value = Number.parseInt(newAmount, 10)
    if (Number.isNaN(value) || value <= 0) return
    if (parsed.presets.includes(value)) return
    const updated = [...parsed.presets, value].sort((a, b) => a - b)
    emit({ presets: updated })
    setNewAmount("")
  }

  const handleRemovePreset = (amount: number) => {
    emit({ presets: parsed.presets.filter((p) => p !== amount) })
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Design Variant */}
      <div className="flex flex-col gap-3">
        <div>
          <Label className="text-sm font-medium">Design Variant</Label>
          <p className="text-xs text-muted-foreground">
            Choose how patron contributions are displayed in the checkout
          </p>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {PATRON_VARIANTS.map((v) => {
            const isActive = variant === v.value
            const Preview = PREVIEW_MAP[v.value]
            return (
              <button
                key={v.value}
                type="button"
                onClick={() =>
                  onChange({
                    ...config,
                    ...parsed,
                    variant: v.value === "default" ? undefined : v.value,
                  })
                }
                className={cn(
                  "relative flex flex-col items-center gap-2 rounded-lg border-2 p-3 text-center transition-all hover:bg-accent/50",
                  isActive ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                {isActive && (
                  <div className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                    <Check className="w-2.5 h-2.5 text-primary-foreground" />
                  </div>
                )}
                <div className="w-full px-1">
                  <Preview />
                </div>
                <div>
                  <p
                    className={cn(
                      "text-xs font-medium",
                      isActive && "text-primary",
                    )}
                  >
                    {v.label}
                  </p>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                    {v.description}
                  </p>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <Separator />

      {/* Preset Amounts */}
      <div className="flex flex-col gap-2">
        <div>
          <Label className="text-sm font-medium">Preset Amounts</Label>
          <p className="text-xs text-muted-foreground">
            Amounts shown as quick-select buttons in the checkout (in cents)
          </p>
        </div>

        {parsed.presets.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {parsed.presets.map((amount) => (
              <div
                key={amount}
                className="flex items-center gap-2 rounded-lg border bg-background px-3 py-2"
              >
                <GripVertical className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <DollarSign className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium flex-1">
                  {formatAmount(amount)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {amount.toLocaleString()} cents
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemovePreset(amount)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">
            No presets configured. Add at least one amount.
          </div>
        )}

        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={newAmount}
            onChange={(e) => setNewAmount(e.target.value)}
            placeholder="e.g. 5000 (= $50)"
            className="h-8 text-sm"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                handleAddPreset()
              }
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={handleAddPreset}
            disabled={
              !newAmount ||
              Number.isNaN(Number.parseInt(newAmount, 10)) ||
              Number.parseInt(newAmount, 10) <= 0
            }
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add
          </Button>
        </div>
      </div>

      {/* Allow Custom Amount */}
      <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
        <div className="flex flex-col gap-0.5">
          <Label className="text-sm font-medium">Allow Custom Amount</Label>
          <p className="text-xs text-muted-foreground">
            Let customers enter a custom contribution amount
          </p>
        </div>
        <Switch
          checked={parsed.allow_custom}
          onCheckedChange={(checked) => emit({ allow_custom: checked })}
          aria-label="Toggle custom amount"
        />
      </div>

      {/* Minimum Custom Amount */}
      {parsed.allow_custom && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-sm font-medium">
            Minimum Custom Amount (cents)
          </Label>
          <Input
            type="number"
            value={parsed.minimum}
            onChange={(e) => {
              const val = Number.parseInt(e.target.value, 10)
              if (!Number.isNaN(val) && val > 0) {
                emit({ minimum: val })
              }
            }}
            placeholder="1000"
            className="max-w-[200px]"
          />
          <p className="text-xs text-muted-foreground">
            {formatAmount(parsed.minimum)} minimum when entering a custom amount
          </p>
        </div>
      )}
    </div>
  )
}
