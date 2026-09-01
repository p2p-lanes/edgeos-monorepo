import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight, BedDouble, Info } from "lucide-react"

import { AccommodationsService } from "@/client"
import { CollapsibleSection } from "@/components/ticketing-step-builder/step-detail/CollapsibleSection"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { TemplateConfigProps } from "./types"

const LAYOUTS = [
  { value: "grid", label: "Grid", description: "Two columns with photos" },
  { value: "list", label: "List", description: "One row per room type" },
] as const

const DEFAULT_NOTICE =
  "Full payment is required to confirm your stay. Accommodation is non-refundable."

/**
 * Config for the `accommodation-booking` step.
 *
 * This panel deliberately edits **no inventory**. Rooms, units, nightly
 * prices, photos and the booking calendar live in the Accommodations section
 * and are shared across steps (and, once sales flows land, across flows).
 * What belongs here is only how accommodation is *offered in this checkout*:
 * which properties, how they look, whether guest names are collected, and the
 * payment notice.
 */
export function AccommodationBookingConfig({
  config,
  onChange,
  popupId,
}: TemplateConfigProps) {
  const selectedIds = Array.isArray(config?.property_ids)
    ? (config.property_ids as string[])
    : []
  const layout = (config?.layout as string) || "grid"
  const showPropertyHeaders = config?.show_property_headers !== false
  const requireGuestNames = config?.require_guest_names !== false
  const noticeText = (config?.notice_text as string) ?? ""
  const accommodationsHref = `/accommodations?popup_id=${popupId}`

  const { data, isLoading } = useQuery({
    queryKey: ["accommodations", "properties", popupId],
    queryFn: () => AccommodationsService.listProperties({ popupId }),
    enabled: !!popupId,
  })

  const properties = data?.results ?? []

  const toggleProperty = (id: string, checked: boolean) => {
    const next = checked
      ? [...selectedIds, id]
      : selectedIds.filter((value) => value !== id)
    onChange({ ...config, property_ids: next })
  }

  const update = (patch: Record<string, unknown>) =>
    onChange({ ...config, ...patch })

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="flex flex-col gap-2">
          <p className="text-xs leading-relaxed text-muted-foreground">
            Rooms, units, nightly prices, photos and the booking calendar are
            managed in <span className="font-medium">Accommodations</span>. This
            step only decides what is offered here and how it looks.
          </p>
          <Button asChild variant="outline" size="sm" className="w-fit">
            {/* Plain anchor, not a typed <Link>: the Accommodations section is
                a separate PR, and coupling this step to a route that does not
                exist yet would block shipping either one on its own. */}
            <a href={accommodationsHref}>
              Manage accommodations
              <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>

      <CollapsibleSection
        title="What is offered"
        description="Pick which properties appear in this checkout"
        defaultOpen
      >
        {isLoading ? (
          <p className="text-xs text-muted-foreground">Loading properties…</p>
        ) : properties.length === 0 ? (
          <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-4">
            <div className="flex items-center gap-2">
              <BedDouble className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">No accommodation yet</p>
            </div>
            <p className="text-xs text-muted-foreground">
              This step has nothing to show until the gathering has at least one
              property with rooms.
            </p>
            <Button asChild size="sm">
              <a href={accommodationsHref}>Add the first property</a>
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              {properties.map((property) => {
                const checked = selectedIds.includes(property.id)
                const inputId = `offer-property-${property.id}`
                return (
                  <div
                    key={property.id}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                      checked
                        ? "border-primary bg-primary/5"
                        : "border-border hover:bg-accent/40",
                    )}
                  >
                    <Checkbox
                      id={inputId}
                      checked={checked}
                      onCheckedChange={(value) =>
                        toggleProperty(property.id, value === true)
                      }
                    />
                    <label
                      htmlFor={inputId}
                      className="flex flex-1 cursor-pointer flex-col"
                    >
                      <span className="text-sm font-medium">
                        {property.name}
                      </span>
                      {property.address ? (
                        <span className="text-xs text-muted-foreground">
                          {property.address}
                        </span>
                      ) : null}
                    </label>
                    {!property.is_active && (
                      <span className="text-xs text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            <p className="text-xs text-muted-foreground">
              {selectedIds.length === 0
                ? "Nothing selected. Every visible property is offered."
                : `${selectedIds.length} of ${properties.length} properties offered.`}
            </p>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        title="Presentation"
        description="Layout and what the buyer is asked for"
      >
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-3">
            <div>
              <Label className="text-sm font-medium">Layout</Label>
              <p className="text-xs text-muted-foreground">
                How room types are laid out in the checkout
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {LAYOUTS.map((option) => {
                const isActive = layout === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => update({ layout: option.value })}
                    className={cn(
                      "flex flex-col items-start gap-0.5 rounded-lg border-2 p-3 text-left transition-all hover:bg-accent/50",
                      isActive ? "border-primary bg-primary/5" : "border-border",
                    )}
                  >
                    <span
                      className={cn(
                        "text-xs font-medium",
                        isActive && "text-primary",
                      )}
                    >
                      {option.label}
                    </span>
                    <span className="text-[10px] leading-tight text-muted-foreground">
                      {option.description}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Group by property</Label>
              <p className="text-xs text-muted-foreground">
                Show a heading above each property's rooms. Turn off when
                everything sits in one building.
              </p>
            </div>
            <Switch
              checked={showPropertyHeaders}
              onCheckedChange={(value) =>
                update({ show_property_headers: value })
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Ask for guest names</Label>
              <p className="text-xs text-muted-foreground">
                Collect a name for every guest. Property owners usually need
                them for their own registry, and they travel to the CSV export.
              </p>
            </div>
            <Switch
              checked={requireGuestNames}
              onCheckedChange={(value) =>
                update({ require_guest_names: value })
              }
            />
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Payment notice"
        description="Shown next to the total"
      >
        <div className="flex flex-col gap-2">
          <Textarea
            value={noticeText}
            placeholder={DEFAULT_NOTICE}
            rows={3}
            onChange={(event) => update({ notice_text: event.target.value })}
          />
          <p className="text-xs text-muted-foreground">
            Leave empty to use the default notice.
          </p>
        </div>
      </CollapsibleSection>
    </div>
  )
}
