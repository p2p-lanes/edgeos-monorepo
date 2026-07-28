import { Check } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import { type FaqItem, FaqItemsEditor, parseFaqItems } from "./FaqItemsEditor"
import type { TemplateConfigProps } from "./types"

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

const FAQ_VARIANTS = [
  {
    value: "accordion",
    label: "Accordion",
    description: "Click to expand each question",
  },
  {
    value: "list",
    label: "List",
    description: "Always-open vertical list",
  },
  {
    value: "two-column",
    label: "Two Column",
    description: "Side-by-side cards on desktop",
  },
  {
    value: "cards",
    label: "Cards",
    description: "Elevated card per question",
  },
] as const

// ---------------------------------------------------------------------------
// Variant previews
// ---------------------------------------------------------------------------

function AccordionPreview() {
  return (
    <div className="flex flex-col gap-0.5 w-full">
      <div className="h-2.5 rounded-sm bg-muted-foreground/20" />
      <div className="h-2.5 rounded-sm bg-muted-foreground/10" />
      <div className="h-2.5 rounded-sm bg-muted-foreground/10" />
    </div>
  )
}

function ListPreview() {
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex flex-col gap-0.5">
        <div className="h-1.5 w-3/5 rounded-sm bg-muted-foreground/25" />
        <div className="h-1 w-full rounded-sm bg-muted-foreground/10" />
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="h-1.5 w-2/5 rounded-sm bg-muted-foreground/25" />
        <div className="h-1 w-full rounded-sm bg-muted-foreground/10" />
      </div>
    </div>
  )
}

function TwoColumnPreview() {
  return (
    <div className="grid grid-cols-2 gap-0.5 w-full">
      <div className="rounded-sm bg-muted-foreground/10 p-0.5">
        <div className="h-1 w-3/4 rounded-sm bg-muted-foreground/25 mb-0.5" />
        <div className="h-0.5 w-full rounded-sm bg-muted-foreground/15" />
      </div>
      <div className="rounded-sm bg-muted-foreground/10 p-0.5">
        <div className="h-1 w-3/4 rounded-sm bg-muted-foreground/25 mb-0.5" />
        <div className="h-0.5 w-full rounded-sm bg-muted-foreground/15" />
      </div>
    </div>
  )
}

function CardsPreview() {
  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center gap-1 rounded-sm bg-muted-foreground/10 p-0.5">
        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
        <div className="flex-1 h-1 rounded-sm bg-muted-foreground/20" />
      </div>
      <div className="flex items-center gap-1 rounded-sm bg-muted-foreground/10 p-0.5">
        <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
        <div className="flex-1 h-1 rounded-sm bg-muted-foreground/20" />
      </div>
    </div>
  )
}

const VARIANT_PREVIEW_MAP: Record<string, React.FC> = {
  accordion: AccordionPreview,
  list: ListPreview,
  "two-column": TwoColumnPreview,
  cards: CardsPreview,
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function FaqsConfig({ config, onChange }: TemplateConfigProps) {
  const variant = (config?.variant as string) || "accordion"
  const title = (config?.title as string) || ""
  const items = parseFaqItems(config?.items)

  return (
    <div className="flex flex-col gap-5">
      {/* Variant selector */}
      <div className="flex flex-col gap-3">
        <div>
          <Label className="text-sm font-medium">FAQ Layout</Label>
          <p className="text-xs text-muted-foreground">
            Choose how questions are displayed in the checkout
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {FAQ_VARIANTS.map((v) => {
            const isActive = variant === v.value
            const Preview = VARIANT_PREVIEW_MAP[v.value]
            return (
              <button
                key={v.value}
                type="button"
                onClick={() =>
                  onChange({
                    ...config,
                    variant: v.value === "accordion" ? undefined : v.value,
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

      <FaqItemsEditor
        title={title}
        items={items}
        onChangeTitle={(next) =>
          onChange({ ...config, title: next || undefined })
        }
        onChangeItems={(next: FaqItem[]) =>
          onChange({ ...config, items: next })
        }
      />
    </div>
  )
}
