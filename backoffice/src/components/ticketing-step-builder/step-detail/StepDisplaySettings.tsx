import { ChevronDown } from "lucide-react"

import { CONTENT_ONLY_TEMPLATES } from "@/components/ticketing-step-builder/constants"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

interface StepDisplaySettingsProps {
  stepType: string
  template: string
  description: string
  onDescriptionChange: (value: string) => void
  watermark: string
  onWatermarkChange: (value: string) => void
  showTitle: boolean
  onShowTitleChange: (value: boolean) => void
  showWatermark: boolean
  onShowWatermarkChange: (value: boolean) => void
  showInNavbar: boolean
  onShowInNavbarChange: (value: boolean) => void
  productCategory: string
  onProductCategoryChange: (value: string) => void
  categorySuggestions: string[] | undefined
  footerText: string
  onFooterTextChange: (value: string) => void
}

export function StepDisplaySettings({
  stepType,
  template,
  description,
  onDescriptionChange,
  watermark,
  onWatermarkChange,
  showTitle,
  onShowTitleChange,
  showWatermark,
  onShowWatermarkChange,
  showInNavbar,
  onShowInNavbarChange,
  productCategory,
  onProductCategoryChange,
  categorySuggestions,
  footerText,
  onFooterTextChange,
}: StepDisplaySettingsProps) {
  const showProductCategory =
    !CONTENT_ONLY_TEMPLATES.has(template) &&
    stepType !== "confirm" &&
    stepType !== "buyer"

  return (
    <Collapsible className="rounded-lg border">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="group flex w-full items-center justify-between gap-2 p-3 text-sm font-medium"
        >
          Display & advanced
          <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-col gap-4 border-t p-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="step-description">Description</Label>
            <Textarea
              id="step-description"
              value={description}
              onChange={(e) => onDescriptionChange(e.target.value)}
              placeholder="Optional description shown to customers"
              rows={3}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="step-watermark">Watermark Text</Label>
            <Input
              id="step-watermark"
              value={watermark}
              onChange={(e) => onWatermarkChange(e.target.value)}
              placeholder="Short text shown as background watermark (e.g., Passes)"
            />
            <p className="text-xs text-muted-foreground">
              Large decorative text shown behind the section header in snap
              layout.
            </p>
          </div>

          <div className="flex flex-col gap-3">
            <VisibilityRow
              label="Show Title"
              help="Display the section title in the checkout"
              checked={showTitle}
              onCheckedChange={onShowTitleChange}
              ariaLabel="Toggle title visibility"
            />
            <VisibilityRow
              label="Show Watermark"
              help="Display the decorative watermark text behind the header"
              checked={showWatermark}
              onCheckedChange={onShowWatermarkChange}
              ariaLabel="Toggle watermark visibility"
            />
            <VisibilityRow
              label="Show in Navbar"
              help="Hidden steps still render and are reachable by scroll, they just don't clutter the top section nav."
              checked={showInNavbar}
              onCheckedChange={onShowInNavbarChange}
              ariaLabel="Toggle navbar visibility"
            />
          </div>

          {showProductCategory && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="step-product-category">Product Category</Label>
              <Select
                value={productCategory}
                onValueChange={(val) => onProductCategoryChange(val)}
              >
                <SelectTrigger id="step-product-category">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  {productCategory &&
                    !(categorySuggestions ?? []).includes(productCategory) && (
                      <SelectItem value={productCategory}>
                        {productCategory}
                      </SelectItem>
                    )}
                  {(categorySuggestions ?? []).map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {cat}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Which product category this step displays. Must match a
                product's category field.
              </p>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="step-footer">Footer Note</Label>
            <Textarea
              id="step-footer"
              value={footerText}
              onChange={(e) => onFooterTextChange(e.target.value)}
              placeholder="Optional note shown below this step's content (e.g., pricing clarifications, terms)"
              rows={2}
            />
            <p className="text-xs text-muted-foreground">
              Small text displayed at the bottom of this section in the
              checkout.
            </p>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function VisibilityRow({
  label,
  help,
  checked,
  onCheckedChange,
  ariaLabel,
  className,
}: {
  label: string
  help: string
  checked: boolean
  onCheckedChange: (value: boolean) => void
  ariaLabel: string
  className?: string
}) {
  return (
    <div className={cn("flex items-center justify-between gap-4", className)}>
      <div className="flex flex-col gap-0.5">
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">{help}</p>
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={ariaLabel}
      />
    </div>
  )
}
