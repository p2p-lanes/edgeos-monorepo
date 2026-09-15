import { useState } from "react"
import type { AttendeeCategoryPublic } from "@/client"
import type { AttendeeCategoryForm, AttendeePassState } from "@/types/Attendee"

type ModalType = {
  isOpen: boolean
  category: AttendeeCategoryForm | null
  editingAttendee: AttendeePassState | null
  isDelete?: boolean
}

const useModal = () => {
  const [modal, setModal] = useState<ModalType>({
    isOpen: false,
    category: null,
    editingAttendee: null,
  })

  const handleOpenModal = (category: AttendeeCategoryPublic) => {
    setModal({
      isOpen: true,
      category,
      editingAttendee: null,
    })
  }

  const handleCloseModal = () => {
    setModal({
      isOpen: false,
      category: null,
      editingAttendee: null,
    })
  }

  /** Edit an attendee — builds a stub category from the attendee's string category field. */
  const handleEdit = (
    attendee: AttendeePassState,
    category?: AttendeeCategoryPublic,
  ) => {
    const resolvedCategory: AttendeeCategoryForm | null =
      category ??
      (attendee.category_id
        ? {
            id: attendee.category_id,
            key: attendee.category ?? "",
            display_meta: {},
            required_fields: [],
          }
        : null)
    setModal({
      isOpen: true,
      category: resolvedCategory,
      editingAttendee: attendee,
    })
  }

  /** Delete an attendee — builds a stub category from the attendee's string category field. */
  const handleDelete = (
    attendee: AttendeePassState,
    category?: AttendeeCategoryPublic,
  ) => {
    const resolvedCategory: AttendeeCategoryForm | null =
      category ??
      (attendee.category_id
        ? {
            id: attendee.category_id,
            key: attendee.category ?? "",
            display_meta: {},
            required_fields: [],
          }
        : null)
    setModal({
      isOpen: true,
      category: resolvedCategory,
      editingAttendee: attendee,
      isDelete: true,
    })
  }

  return {
    modal,
    handleOpenModal,
    handleCloseModal,
    handleEdit,
    handleDelete,
  }
}
export default useModal
