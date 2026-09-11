import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight, BedDouble, Info, TriangleAlert } from "lucide-react"
import { useState } from "react"

import { AccommodationsService } from "@/client"
import {
  GuestFormEditor,
  parseForm,
  toApi,
} from "@/components/accommodations/guest-form"
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
  {
    value: "rows",
    label: "Rows",
    description:
      "One wide row per room, prices in a column. Reads well at any offer size.",
  },
  {
    value: "cards",
    label: "Cards",
    description:
      "Two columns, photo first. Best when every room is photographed.",
  },
  {
    value: "sheet",
    label: "Sheet",
    description:
      "One line per room, opens in place. Best past a screenful of rooms.",
  },
] as const

/**
 * What the first two layouts are called now.
 *
 * The backend renames these on save, but a step saved before the rename
 * still answers with the old name until someone touches it, and the picker
 * has to light up the right option in the meantime.
 */
const RENAMED_LAYOUTS: Record<string, string> = { grid: "cards", list: "rows" }

/** A sketch of what each layout does with the space, at picker size. */
function LayoutSketch({ value, active }: { value: string; active: boolean }) {
  const fill = active ? "bg-primary/50" : "bg-muted-foreground/30"
  return (
    <div className="flex h-8 w-11 shrink-0 flex-col justify-center gap-[3px] rounded border border-border/60 bg-background p-1">
      {value === "rows" &&
        [0, 1, 2].map((row) => (
          <div key={row} className="flex items-center gap-[3px]">
            <div className={cn("h-[6px] w-[6px] rounded-[1px]", fill)} />
            <div className={cn("h-[6px] flex-1 rounded-[1px]", fill)} />
          </div>
        ))}
      {value === "cards" && (
        <div className="grid grid-cols-2 gap-[3px]">
          {[0, 1, 2, 3].map((cell) => (
            <div key={cell} className={cn("h-[9px] rounded-[1px]", fill)} />
          ))}
        </div>
      )}
      {value === "sheet" &&
        [0, 1, 2, 3].map((line) => (
          <div
            key={line}
            className={cn("h-[3px] w-full rounded-[1px]", fill)}
          />
        ))}
    </div>
  )
}

const DEFAULT_NOTICE =
  "Full payment is required to confirm your stay. Accommodation is non-refundable."

/**
 * Config for the `accommodation-booking` step.
 *
 * This panel deliberately edits **no inventory**. Rooms, units, nightly
 * prices, photos and the booking calendar live in the Accommodations section
 * and are shared across steps (and, once sales flows land, across flows).
 * What belongs here is only how accommodation is *offered in this checkout*:
 * which properties, how they look, what the people staying are asked, and the
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
  const storedLayout = (config?.layout as string) || "rows"
  const layout = RENAMED_LAYOUTS[storedLayout] ?? storedLayout
  const showPropertyHeaders = config?.show_property_headers !== false
  const requireGuestNames = config?.require_guest_names !== false
  const noticeText = (config?.notice_text as string) ?? ""
  // Parsed on every render rather than held in state: the panel is
  // controlled by `config`, and a second copy would drift the moment a step
  // is switched underneath it.
  const guestForm = parseForm(config?.guest_form)
  const accommodationsHref = `/accommodations?popup_id=${popupId}`

  const { data, isLoading } = useQuery({
    queryKey: ["accommodations", "properties", popupId],
    queryFn: () => AccommodationsService.listProperties({ popupId }),
    enabled: !!popupId,
  })

  const properties = data?.results ?? []

  /**
   * Whether the operator is narrowing the offer.
   *
   * An empty `property_ids` means "every property" on the wire, which is what
   * makes a freshly enabled step work instead of showing an empty checkout.
   * A list of unticked boxes does not say that: it reads as "I have chosen
   * nothing", and the checkout then offers everything. So the choice is made
   * explicit here, and the boxes only appear once it is "only some".
   *
   * Local state, because "narrowing, but nothing ticked yet" is a real step
   * in the operator's hands and has no representation in the stored config.
   */
  const [narrowing, setNarrowing] = useState(false)
  const offersEverything = selectedIds.length === 0
  const showPicker = narrowing || !offersEverything

  const toggleProperty = (id: string, checked: boolean) => {
    const next = checked
      ? [...selectedIds, id]
      : selectedIds.filter((value) => value !== id)
    onChange({ ...config, property_ids: next })
  }

  const offerEverything = () => {
    setNarrowing(false)
    onChange({ ...config, property_ids: [] })
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
            {/* The choice, spelled out. An empty subset means "everything" to
                the backend, and a column of unticked boxes is the one thing
                that cannot say so on its own. */}
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                aria-pressed={!showPicker}
                onClick={offerEverything}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-lg border-2 p-3 text-left transition-all hover:bg-accent/50",
                  showPicker ? "border-border" : "border-primary bg-primary/5",
                )}
              >
                <span
                  className={cn(
                    "text-xs font-medium",
                    !showPicker && "text-primary",
                  )}
                >
                  Every property
                </span>
                <span className="text-[10px] leading-tight text-muted-foreground">
                  All {properties.length} appear in this checkout, and so does
                  anything added later.
                </span>
              </button>
              <button
                type="button"
                aria-pressed={showPicker}
                onClick={() => setNarrowing(true)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-lg border-2 p-3 text-left transition-all hover:bg-accent/50",
                  showPicker ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <span
                  className={cn(
                    "text-xs font-medium",
                    showPicker && "text-primary",
                  )}
                >
                  Only some
                </span>
                <span className="text-[10px] leading-tight text-muted-foreground">
                  Sell a subset here and leave the rest to another step.
                </span>
              </button>
            </div>

            {/* The list stays visible either way. "Every property" is a
                claim about these names, and hiding them makes the operator
                take it on trust. Only the checkbox comes and goes. */}
            <div className="flex flex-col gap-2">
              {properties.map((property) => {
                const checked = showPicker && selectedIds.includes(property.id)
                const inputId = `offer-property-${property.id}`
                const name = (
                  <>
                    <span className="text-sm font-medium">{property.name}</span>
                    {property.address ? (
                      <span className="text-xs text-muted-foreground">
                        {property.address}
                      </span>
                    ) : null}
                  </>
                )
                return (
                  <div
                    key={property.id}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border p-3 transition-colors",
                      checked && "border-primary bg-primary/5",
                      !checked &&
                        showPicker &&
                        "border-border hover:bg-accent/40",
                      !showPicker && "border-border bg-muted/30",
                    )}
                  >
                    {showPicker && (
                      <Checkbox
                        id={inputId}
                        checked={checked}
                        onCheckedChange={(value) =>
                          toggleProperty(property.id, value === true)
                        }
                      />
                    )}
                    {showPicker ? (
                      <label
                        htmlFor={inputId}
                        className="flex flex-1 cursor-pointer flex-col"
                      >
                        {name}
                      </label>
                    ) : (
                      <div className="flex flex-1 flex-col">{name}</div>
                    )}
                    {!property.is_active && (
                      <span className="text-xs text-muted-foreground">
                        Inactive
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {showPicker &&
              (offersEverything ? (
                // Not a nag: this state really does offer everything, because
                // an empty list is how "everything" is stored.
                <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                  <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <p className="text-xs leading-relaxed">
                    Nothing ticked, so the checkout still offers every property.
                    Tick at least one to narrow it.
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {selectedIds.length} of {properties.length} properties
                  offered.
                </p>
              ))}
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
            <div className="flex flex-col gap-2">
              {LAYOUTS.map((option) => {
                const isActive = layout === option.value
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={isActive}
                    onClick={() => update({ layout: option.value })}
                    className={cn(
                      "flex items-center gap-3 rounded-lg border-2 p-3 text-left transition-all hover:bg-accent/50",
                      isActive
                        ? "border-primary bg-primary/5"
                        : "border-border",
                    )}
                  >
                    <LayoutSketch value={option.value} active={isActive} />
                    <span className="flex min-w-0 flex-col gap-0.5">
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
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Guest details"
        description="What the checkout asks about the people staying"
      >
        <div className="flex flex-col gap-5">
          {/* The name switch lives here rather than under Presentation: it
              answers the same question as everything below it, and an
              operator deciding what to ask should see it in one place. */}
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

          <Separator />

          <GuestFormEditor
            value={guestForm}
            onChange={(next) =>
              // `toApi` returns null for a form that asks nothing, which is
              // how the step stores "no questions beyond the name".
              update({ guest_form: toApi(next) })
            }
          />
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
