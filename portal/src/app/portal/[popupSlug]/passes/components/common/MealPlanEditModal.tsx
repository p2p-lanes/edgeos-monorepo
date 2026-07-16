"use client"

import { Lock } from "lucide-react"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  DayPlanEditor,
  type MealPlanProduct,
  type MealPlanTemplateConfigInput,
  parseMealPlanTemplateConfig,
} from "@/components/checkout-flow/variants/mealPlanShared"
import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import Modal from "@/components/ui/modal"
import useUpdateMealPlanTicket from "@/hooks/useUpdateMealPlanTicket"
import { deriveProductState } from "@/lib/product-state"
import type { AttendeePassState, TicketEntry } from "@/types/Attendee"
import type { ProductsPass } from "@/types/Products"

interface MealPlanEditModalProps {
  open: boolean
  onClose: () => void
  attendee: AttendeePassState
  /** The attendee's meal-plan ticket entries (each with product_id, id,
   *  purchase_metadata). */
  mealPlanEntries: TicketEntry[]
  /** Raw template_config of the popup's meal-plan-select step. */
  templateConfig: MealPlanTemplateConfigInput
  /** Products from the passes provider — used to match coverage/menu_options
   *  and to derive each week's sale state (lock). */
  products: ProductsPass[]
}

interface WeekDraft {
  dailyChoices: Record<string, string>
  dietaryRestriction: string
  specialRequest: string
}

type DraftState = Record<string, WeekDraft>

function seedFromEntries(entries: TicketEntry[]): DraftState {
  const out: DraftState = {}
  for (const entry of entries) {
    const md = (entry.purchase_metadata ?? {}) as Record<string, unknown>
    out[entry.id] = {
      dailyChoices: { ...((md.daily_choices as Record<string, string>) ?? {}) },
      dietaryRestriction: (md.dietary_restriction as string) ?? "",
      specialRequest: (md.special_request as string) ?? "",
    }
  }
  return out
}

export function MealPlanEditModal({
  open,
  onClose,
  attendee,
  mealPlanEntries,
  templateConfig,
  products,
}: MealPlanEditModalProps) {
  const { updateMealPlanTicket, isPending } = useUpdateMealPlanTicket()

  // Match each ticket's product_id to its weekly config + ProductsPass.
  const mealPlanProductById = useMemo(() => {
    const { sections } = parseMealPlanTemplateConfig(templateConfig, products)
    const map = new Map<string, MealPlanProduct<ProductsPass>>()
    for (const section of sections) {
      for (const p of section.products) map.set(p.id, p)
    }
    return map
  }, [templateConfig, products])

  // Local edit state seeded from each ticket's purchase_metadata (NOT the cart).
  // Reseed whenever the modal opens so a cancelled edit doesn't leak forward.
  const [drafts, setDrafts] = useState<DraftState>({})
  const seedRef = useRef<DraftState>({})
  useEffect(() => {
    if (open) {
      const seed = seedFromEntries(mealPlanEntries)
      seedRef.current = seed
      setDrafts(seed)
    }
  }, [open, mealPlanEntries])

  const setDay = (ticketId: string, date: string, menuKey: string) => {
    setDrafts((prev) => ({
      ...prev,
      [ticketId]: {
        ...prev[ticketId],
        dailyChoices: { ...prev[ticketId]?.dailyChoices, [date]: menuKey },
      },
    }))
  }

  const setDietary = (ticketId: string, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [ticketId]: { ...prev[ticketId], dietaryRestriction: value },
    }))
  }

  const setSpecial = (ticketId: string, value: string) => {
    setDrafts((prev) => ({
      ...prev,
      [ticketId]: { ...prev[ticketId], specialRequest: value },
    }))
  }

  const isLockedEntry = (entry: TicketEntry): boolean => {
    const mp = mealPlanProductById.get(entry.product_id)
    if (!mp) return true
    return deriveProductState(mp.product) === "ended"
  }

  const handleSave = async () => {
    // Save only editable weeks whose draft actually changed.
    const changed = mealPlanEntries.filter((entry) => {
      if (isLockedEntry(entry)) return false
      const draft = drafts[entry.id]
      const seed = seedRef.current[entry.id]
      return JSON.stringify(draft) !== JSON.stringify(seed)
    })

    if (changed.length === 0) {
      onClose()
      return
    }

    try {
      for (const entry of changed) {
        const draft = drafts[entry.id]
        await updateMealPlanTicket({
          attendeeId: attendee.id,
          ticketId: entry.id,
          body: {
            daily_choices: draft.dailyChoices,
            dietary_restriction: draft.dietaryRestriction || null,
            special_request: draft.specialRequest || null,
          },
        })
      }
      onClose()
    } catch {
      // Errors are surfaced as toasts by the mutation hook; keep the modal open
      // so the user can retry.
    }
  }

  // Only render entries that resolve to a known meal-plan week.
  const renderableEntries = mealPlanEntries.filter((e) =>
    mealPlanProductById.has(e.product_id),
  )

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Edit meal plan"
      description={`Update ${attendee.name}'s meal choices for upcoming weeks. Closed weeks can no longer be changed.`}
      className="max-w-2xl"
    >
      <div className="space-y-5 max-h-[65vh] overflow-y-auto pr-1">
        {renderableEntries.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No editable meal-plan weeks found.
          </p>
        )}

        {renderableEntries.map((entry) => {
          const mp = mealPlanProductById.get(entry.product_id)
          if (!mp) return null
          const locked = isLockedEntry(entry)
          const draft = drafts[entry.id] ?? {
            dailyChoices: {},
            dietaryRestriction: "",
            specialRequest: "",
          }

          return (
            <div
              key={entry.id}
              className="rounded-xl border border-border p-3 sm:p-4 space-y-3"
            >
              {locked && (
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Lock className="w-3 h-3" />
                  Edición cerrada
                </div>
              )}

              <DayPlanEditor
                product={mp}
                dailyChoices={draft.dailyChoices}
                onSetDay={(d, key) => setDay(entry.id, d, key)}
                disabled={locked}
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label
                    htmlFor={`${entry.id}-mp-restriction`}
                    className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Dietary restriction & allergies
                  </Label>
                  <Input
                    id={`${entry.id}-mp-restriction`}
                    value={draft.dietaryRestriction}
                    disabled={locked}
                    placeholder="e.g. peanut allergy, gluten-free"
                    onChange={(e) => setDietary(entry.id, e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor={`${entry.id}-mp-special`}
                    className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    Special request
                  </Label>
                  <Input
                    id={`${entry.id}-mp-special`}
                    value={draft.specialRequest}
                    disabled={locked}
                    placeholder="Anything else for our chef?"
                    onChange={(e) => setSpecial(entry.id, e.target.value)}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <DialogFooter className="gap-2 sm:gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="button" onClick={handleSave} disabled={isPending}>
          {isPending ? "Saving…" : "Save changes"}
        </Button>
      </DialogFooter>
    </Modal>
  )
}

export default MealPlanEditModal
