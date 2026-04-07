import { Check } from "lucide-react"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { TemplateConfigProps } from "./types"

const HOUSING_VARIANTS = [
  {
    value: "default",
    label: "Default",
    description: "Full cards with image overlay",
  },
  {
    value: "compact",
    label: "Compact",
    description: "Minimal rows with thumbnails",
  },
  {
    value: "grid",
    label: "Grid",
    description: "2-column image gallery",
  },
] as const

function DefaultPreview() {
  return (
    <div className="flex flex-col gap-1.5 w-full">
      <div className="h-8 rounded bg-muted-foreground/10 relative overflow-hidden">
        <div className="absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-muted-foreground/20 to-transparent" />
        <div className="absolute bottom-0.5 left-1 h-1 w-8 rounded-full bg-muted-foreground/30" />
      </div>
      <div className="flex items-center justify-between px-0.5">
        <div className="flex flex-col gap-0.5">
          <div className="h-1 w-10 rounded-full bg-muted-foreground/25" />
          <div className="h-1 w-6 rounded-full bg-muted-foreground/15" />
        </div>
        <div className="h-1.5 w-5 rounded-full bg-muted-foreground/25" />
      </div>
    </div>
  )
}

function CompactPreview() {
  return (
    <div className="flex flex-col gap-1 w-full">
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex items-center gap-1 rounded bg-muted-foreground/5 p-0.5"
        >
          <div className="w-1 h-1 rounded-full bg-muted-foreground/20 shrink-0" />
          <div className="w-3 h-3 rounded-sm bg-muted-foreground/10 shrink-0" />
          <div className="flex-1 flex flex-col gap-0.5">
            <div className="h-0.5 w-6 rounded-full bg-muted-foreground/20" />
            <div className="h-0.5 w-4 rounded-full bg-muted-foreground/10" />
          </div>
          <div className="h-1 w-3 rounded-full bg-muted-foreground/20 shrink-0" />
        </div>
      ))}
    </div>
  )
}

function GridPreview() {
  return (
    <div className="grid grid-cols-2 gap-1 w-full">
      {[0, 1].map((i) => (
        <div
          key={i}
          className="flex flex-col rounded overflow-hidden border border-muted-foreground/10"
        >
          <div className="h-5 bg-muted-foreground/10" />
          <div className="p-0.5 flex flex-col gap-0.5">
            <div className="h-0.5 w-6 rounded-full bg-muted-foreground/20" />
            <div className="h-0.5 w-4 rounded-full bg-muted-foreground/10" />
          </div>
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

export function HousingDateConfig({ config, onChange }: TemplateConfigProps) {
  const variant = (config?.variant as string) || "default"

  return (
    <div className="flex flex-col gap-3">
      <div>
        <Label className="text-sm font-medium">Design Variant</Label>
        <p className="text-xs text-muted-foreground">
          Choose how housing options are displayed in the checkout
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {HOUSING_VARIANTS.map((v) => {
          const isActive = variant === v.value
          const Preview = PREVIEW_MAP[v.value]
          return (
            <button
              key={v.value}
              type="button"
              onClick={() =>
                onChange({
                  ...config,
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
  )
}
