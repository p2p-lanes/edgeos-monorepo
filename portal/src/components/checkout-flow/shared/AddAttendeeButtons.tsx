"use client"

import { Plus } from "lucide-react"
import { useState } from "react"
import { AttendeeModal } from "@/app/portal/[popupSlug]/passes/components/AttendeeModal"
import useAttendee from "@/hooks/useAttendee"
import { cn } from "@/lib/utils"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import type { AttendeeCategory, AttendeePassState } from "@/types/Attendee"

interface AddAttendeeButtonsProps {
  /** Invoked after a successful add with the new attendee's id so the parent can scroll to it. */
  onAttendeeAdded?: (attendeeId: string) => void
  className?: string
}

type ModalState = {
  isOpen: boolean
  category: AttendeeCategory | null
}

export default function AddAttendeeButtons({
  onAttendeeAdded,
  className,
}: AddAttendeeButtonsProps) {
  const { getCity } = useCityProvider()
  const { getAttendees } = useApplication()
  const { addAttendee } = useAttendee()
  const [modal, setModal] = useState<ModalState>({
    isOpen: false,
    category: null,
  })

  const city = getCity()
  const attendees = getAttendees()
  const hasSpouse = attendees.some((a) => a.category === "spouse")
  const hasMain = attendees.length > 0

  const canShowSpouse = !!city?.allows_spouse
  const canShowKids = !!city?.allows_children

  if (!canShowSpouse && !canShowKids) return null

  const openModal = (category: AttendeeCategory) => {
    setModal({ isOpen: true, category })
  }

  const closeModal = () => {
    setModal({ isOpen: false, category: null })
  }

  const handleSubmit = async (data: AttendeePassState) => {
    if (!modal.category) return

    // Capture the attendee IDs before the mutation so we can identify the new one.
    const before = new Set(getAttendees().map((a) => a.id))

    await addAttendee({
      name: data.name ?? "",
      email: data.email ?? "",
      category: modal.category,
      gender: data.gender ?? "",
    })

    const after = getAttendees()
    const newAttendee = after.find((a) => !before.has(a.id))

    closeModal()

    if (newAttendee && onAttendeeAdded) {
      // Defer to next tick so the consumer re-renders with the new card before scrolling.
      setTimeout(() => onAttendeeAdded(newAttendee.id), 0)
    }
  }

  const showSpouseLink = canShowSpouse && !hasSpouse
  const showSeparator = showSpouseLink && canShowKids

  return (
    <>
      <div
        className={cn(
          "flex flex-wrap items-center gap-3 text-sm px-1",
          className,
        )}
      >
        {showSpouseLink && (
          <button
            type="button"
            onClick={() => openModal("spouse")}
            disabled={!hasMain}
            className={cn(
              "flex items-center gap-1.5 transition-colors whitespace-nowrap group",
              hasMain
                ? "text-gray-600 hover:text-gray-900"
                : "text-gray-300 cursor-not-allowed",
            )}
          >
            <div
              className={cn(
                "p-0.5 rounded-full transition-colors",
                hasMain ? "bg-gray-100 group-hover:bg-gray-200" : "bg-gray-100",
              )}
            >
              <Plus className="w-3 h-3" />
            </div>
            <span>Add spouse</span>
          </button>
        )}
        {showSeparator && <span className="text-gray-300">|</span>}
        {canShowKids && (
          <button
            type="button"
            onClick={() => openModal("kid")}
            disabled={!hasMain}
            className={cn(
              "flex items-center gap-1.5 transition-colors whitespace-nowrap group",
              hasMain
                ? "text-gray-600 hover:text-gray-900"
                : "text-gray-300 cursor-not-allowed",
            )}
          >
            <div
              className={cn(
                "p-0.5 rounded-full transition-colors",
                hasMain ? "bg-gray-100 group-hover:bg-gray-200" : "bg-gray-100",
              )}
            >
              <Plus className="w-3 h-3" />
            </div>
            <span>Add child</span>
          </button>
        )}
      </div>

      {modal.isOpen && modal.category && (
        <AttendeeModal
          open={modal.isOpen}
          onClose={closeModal}
          onSubmit={handleSubmit}
          category={modal.category}
          editingAttendee={null}
        />
      )}
    </>
  )
}
