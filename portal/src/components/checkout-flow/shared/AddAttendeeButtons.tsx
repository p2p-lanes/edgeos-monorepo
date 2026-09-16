"use client"

import { Plus } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { AttendeeModal } from "@/app/portal/[popupSlug]/passes/components/AttendeeModal"
import type { AttendeeCategoryPublic } from "@/client"
import useAttendee from "@/hooks/useAttendee"
import { useAttendeeCategories } from "@/hooks/useAttendeeCategories"
import { cn } from "@/lib/utils"
import { useCityProvider } from "@/providers/cityProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import type { AttendeePassState } from "@/types/Attendee"
import { resolveRecipientRoleLabel } from "./recipientAssignmentLabels"

interface AddAttendeeButtonsProps {
  onAttendeeAdded?: (attendeeId: string) => void
  className?: string
  allowedCategoryIds?: string[] | null
  mode?: "checkout" | "management"
  salesFlowId?: string | null
}

export default function AddAttendeeButtons({
  onAttendeeAdded,
  className,
  allowedCategoryIds,
  mode = "checkout",
  salesFlowId,
}: AddAttendeeButtonsProps) {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const city = getCity()
  const popupId = city?.id ? String(city.id) : ""
  const { categories } = useAttendeeCategories(popupId, salesFlowId)
  const { attendeePasses: attendees, addRecipientDraft } = usePassesProvider()
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

  const categoryIsAvailable = (category: AttendeeCategoryPublic) => {
    if (category.is_primary) return false
    if (allowedCategoryIds && !allowedCategoryIds.includes(category.id))
      return false
    const max = category.max_per_application
    if (max == null) return true
    const current = countByCategoryId.get(category.id) ?? 0
    return current < max
  }
  const available = categories.filter((c) => {
    return categoryIsAvailable(c)
  })
  if (available.length === 0) return null

  const handleSubmit = async (
    data: AttendeePassState & { category_id?: string },
  ) => {
    if (!selectedCategory) return
    if (mode === "management") {
      const attendee = await addAttendee({
        name: data.name ?? "",
        email: data.email ?? "",
        category_id: data.category_id ?? selectedCategory.id,
        gender: data.gender ?? "",
        additional_data: data.additional_data,
      })
      setSelectedCategory(null)
      if (attendee?.id) onAttendeeAdded?.(attendee.id)
      return
    }

    const recipientKey = `draft:${crypto.randomUUID()}`
    const email = data.email?.trim()
    const attendeeId = addRecipientDraft({
      recipient_key: recipientKey,
      name: data.name ?? "",
      ...(email ? { email } : {}),
      category_id: data.category_id ?? selectedCategory.id,
      profile_snapshot: {
        ...(data.additional_data ?? {}),
        category: selectedCategory.key,
        gender: data.gender ?? "",
      },
    })
    setSelectedCategory(null)
    onAttendeeAdded?.(attendeeId)
  }

  return (
    <>
      {available.map((cat) => (
        <button
          key={cat.id}
          type="button"
          onClick={() => setSelectedCategory(cat)}
          disabled={mode === "management" && loading}
          className={cn(
            "flex items-center gap-1.5 text-pass-text hover:text-pass-title transition-colors whitespace-nowrap disabled:opacity-50",
            className,
          )}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>
            {t("checkout.recipient_assignment.add_role", {
              role: resolveRecipientRoleLabel(cat, t),
            })}
          </span>
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
