import {
  CHECKOUT_ICON_CATALOG,
  CHECKOUT_ICON_GROUPS,
  getRegistryIcon,
  resolveStepIcon,
} from "@edgeos/shared-form-ui"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

interface StepIconPickerProps {
  /** The step's stored `emoji` value: a curated slug, a literal emoji, or "". */
  value: string
  /** Receives a slug, a literal emoji, or "" meaning "use the default icon". */
  onChange: (value: string) => void
  stepType: string
  template: string | null
}

/**
 * Icon chooser for a ticketing step. Writes into the same single `emoji`
 * string the checkout already reads, so a curated pick and a hand-typed
 * emoji are the same field — `getRegistryIcon` is what tells them apart.
 */
export function StepIconPicker({
  value,
  onChange,
  stepType,
  template,
}: StepIconPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  const trimmed = value.trim()
  const PickedIcon = getRegistryIcon(trimmed)
  // The icon the checkout falls back to when the operator picks nothing.
  const DefaultIcon = resolveStepIcon({ stepType, template })

  const normalisedQuery = query.trim().toLowerCase()
  const matches = normalisedQuery
    ? CHECKOUT_ICON_CATALOG.filter(
        (entry) =>
          entry.slug.includes(normalisedQuery) ||
          entry.label.toLowerCase().includes(normalisedQuery),
      )
    : CHECKOUT_ICON_CATALOG

  const select = (next: string) => {
    onChange(next)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) setQuery("")
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-16 shrink-0"
          aria-label="Step icon"
        >
          {PickedIcon ? (
            <PickedIcon className="h-4 w-4" aria-hidden="true" />
          ) : trimmed ? (
            <span className="text-lg leading-none">{trimmed}</span>
          ) : (
            <DefaultIcon
              className="h-4 w-4 text-muted-foreground"
              aria-hidden="true"
            />
          )}
        </Button>
      </PopoverTrigger>

      <PopoverContent align="start" className="w-80 p-0">
        <Tabs defaultValue="icons">
          <TabsList className="w-full rounded-none border-b">
            <TabsTrigger value="icons" className="flex-1">
              Icons
            </TabsTrigger>
            <TabsTrigger value="emoji" className="flex-1">
              Emoji
            </TabsTrigger>
          </TabsList>

          <TabsContent value="icons" className="m-0 p-3">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search icons…"
              className="h-8"
              aria-label="Search icons"
            />

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 h-7 w-full justify-start gap-2 text-xs"
              onClick={() => select("")}
            >
              <DefaultIcon
                className="h-3.5 w-3.5 text-muted-foreground"
                aria-hidden="true"
              />
              Use the default icon
            </Button>

            <div className="mt-2 max-h-64 overflow-y-auto">
              {matches.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  No icons match "{query}".
                </p>
              ) : (
                CHECKOUT_ICON_GROUPS.map((group) => {
                  const groupIcons = matches.filter(
                    (entry) => entry.group === group,
                  )
                  if (groupIcons.length === 0) return null
                  return (
                    <div key={group} className="mb-2">
                      <p className="px-1 pb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {group}
                      </p>
                      <div className="grid grid-cols-7 gap-1">
                        {groupIcons.map(({ slug, label, Icon }) => (
                          <button
                            key={slug}
                            type="button"
                            title={label}
                            aria-label={label}
                            aria-pressed={slug === trimmed}
                            onClick={() => select(slug)}
                            className={cn(
                              "flex aspect-square items-center justify-center rounded-md hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              slug === trimmed && "bg-muted ring-1 ring-primary",
                            )}
                          >
                            <Icon className="h-4 w-4" aria-hidden="true" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </TabsContent>

          <TabsContent value="emoji" className="m-0 p-3">
            <Input
              value={PickedIcon ? "" : trimmed}
              onChange={(e) => onChange(e.target.value.slice(0, 8))}
              placeholder="🎟️"
              className="text-center text-lg"
              aria-label="Step emoji"
            />
            <p className="mt-2 text-xs text-muted-foreground">
              Any emoji, up to 8 characters. Picking an icon replaces it.
            </p>
          </TabsContent>
        </Tabs>
      </PopoverContent>
    </Popover>
  )
}
