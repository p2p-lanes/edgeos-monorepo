"use client"

import { Plus } from "lucide-react"
import { useState } from "react"
import { AttendeeModal } from "@/app/portal/[popupSlug]/passes/components/AttendeeModal"
import type { AttendeeCategoryPublic } from "@/client"
import useAttendee from "@/hooks/useAttendee"
import { useAttendeeCategories } from "@/hooks/useAttendeeCategories"
import { cn } from "@/lib/utils"
import { useCityProvider } from "@/providers/cityProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import type { AttendeePassState } from "@/types/Attendee"

interface AddAttendeeButtonsProps {
  onAttendeeAdded?: (attendeeId: string) => void
  className?: string
}

function resolveLabel(cat: AttendeeCategoryPublic): string {
  const meta = cat.display_meta as Record<string, unknown> | undefined
  const metaLabel = meta?.label
  if (metaLabel && typeof metaLabel === "string" && metaLabel.trim() !== "") {
    return metaLabel
  }
  return cat.key.charAt(0).toUpperCase() + cat.key.slice(1)
}

export default function AddAttendeeButtons({
  onAttendeeAdded,
  className,
}: AddAttendeeButtonsProps) {
  const { getCity } = useCityProvider()
  const city = getCity()
  const popupId = city?.id ? String(city.id) : ""
  const { categories } = useAttendeeCategories(popupId)
  const { attendeePasses: attendees } = usePassesProvider()
  const { addAttendee, loading } = useAttendee()

  const [selectedCategory, setSelectedCategory] =
    useState<AttendeeCategoryPublic | null>(null)

  if (!popupId || !categories || categories.length === 0) return null

  // Count existing attendees per category so we can hide buttons that have
  // already hit their max_per_application. Backend still enforces the cap;
  // this just stops users from clicking buttons that are bound to fail.
  const countByCategoryId = new Map<string, number>()
  for (const a of attendees) {
    const id = a.category_id
    if (!id) continue
    countByCategoryId.set(id, (countByCategoryId.get(id) ?? 0) + 1)
  }

  const available = categories.filter((c) => {
    if (c.is_primary) return false
    if (c.enabled_in_passes_flow === false) return false
    const max = c.max_per_application
    if (max == null) return true
    const current = countByCategoryId.get(c.id) ?? 0
    return current < max
  })

  if (available.length === 0) return null

  const handleSubmit = async (
    data: AttendeePassState & { category_id?: string },
  ) => {
    if (!selectedCategory) return
    const result = await addAttendee({
      name: data.name ?? "",
      email: data.email ?? "",
      category_id: data.category_id ?? selectedCategory.id,
      gender: data.gender ?? "",
    })
    setSelectedCategory(null)
    if (result?.id && onAttendeeAdded) onAttendeeAdded(result.id)
  }

  return (
    <>
      {available.map((cat) => (
        <button
          key={cat.id}
          type="button"
          onClick={() => setSelectedCategory(cat)}
          disabled={loading}
          className={cn(
            "flex items-center gap-1.5 text-pass-text hover:text-pass-title transition-colors whitespace-nowrap disabled:opacity-50",
            className,
          )}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add {resolveLabel(cat)}</span>
        </button>
      ))}

      {selectedCategory && (
        <AttendeeModal
          open={true}
          onClose={() => setSelectedCategory(null)}
          onSubmit={handleSubmit}
          category={selectedCategory}
          editingAttendee={null}
        />
      )}
    </>
  )
}
