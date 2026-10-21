import { AnimatePresence, motion } from "framer-motion"
import { ChevronDown, Pencil, Trash2, User } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { GroupMemberPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import MemberFormModal from "./AddMemberModal"
import ConfirmDeleteModal from "./ConfirmDeleteModal"
import DetailItem from "./DetailItem"

interface MemberItemProps {
  member: GroupMemberPublic
  onMemberUpdated?: () => void
  /** Whether the viewer leads the group and may edit or remove members. */
  canManageMembers?: boolean
}

const MemberItem = ({
  member,
  onMemberUpdated,
  canManageMembers,
}: MemberItemProps) => {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false)

  const fullName = `${member.first_name} ${member.last_name}`
  const isPassHolder = (member.products?.length ?? 0) > 0

  // Email is always shown; the rest only when the member filled them in.
  const optionalDetails = [
    { label: t("groups.gender"), value: member.gender },
    { label: t("groups.telegram"), value: member.telegram },
    { label: t("groups.organization"), value: member.organization },
    { label: t("groups.role"), value: member.role },
  ].filter(
    (detail): detail is { label: string; value: string } =>
      !!detail.value?.trim(),
  )

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent expand/collapse when clicking edit
    setIsEditModalOpen(true)
  }

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent expand/collapse when clicking delete
    setIsDeleteModalOpen(true)
  }

  const handleModalClose = () => {
    setIsEditModalOpen(false)
  }

  const handleDeleteModalClose = () => {
    setIsDeleteModalOpen(false)
  }

  const handleUpdateSuccess = () => {
    handleModalClose()

    // Call the refresh function passed from the parent component
    if (onMemberUpdated) {
      onMemberUpdated()
    }
  }

  const handleDeleteSuccess = () => {
    handleDeleteModalClose()

    // Call the refresh function passed from the parent component
    if (onMemberUpdated) {
      onMemberUpdated()
    }
  }

  return (
    <div className="border rounded-md overflow-hidden bg-white">
      <button
        type="button"
        className="w-full p-4 flex items-center justify-between cursor-pointer hover:bg-gray-50"
        onClick={() => setIsExpanded(!isExpanded)}
        aria-expanded={isExpanded}
        aria-label={t("groups.toggle_member_details", { name: fullName })}
      >
        <div className="flex flex-wrap items-center gap-3">
          <User size={20} />
          <span className="font-medium">{fullName}</span>
          {member.is_leader && (
            <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
              {t("groups.role_leader")}
            </span>
          )}
          {isPassHolder && (
            <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full">
              {t("groups.pass_holder")}
            </span>
          )}
        </div>
        <motion.span
          className="text-gray-400 hover:text-gray-600 transition-all duration-300"
          aria-label={isExpanded ? t("groups.collapse") : t("groups.expand")}
          initial={false}
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 0.3, ease: "easeInOut" }}
        >
          <ChevronDown size={16} />
        </motion.span>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            className="bg-white"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: "easeInOut" }}
          >
            <div className="px-6 pb-6 pt-2">
              <div className="grid grid-cols-2 gap-4">
                <DetailItem label={t("groups.email")} value={member.email} />
                {optionalDetails.map((detail) => (
                  <DetailItem
                    key={detail.label}
                    label={detail.label}
                    value={detail.value}
                  />
                ))}
              </div>

              <div className="flex justify-end gap-3">
                {canManageMembers && (
                  <>
                    <Button
                      variant={"outline"}
                      aria-label={t("groups.edit_member")}
                      onClick={handleEditClick}
                    >
                      <Pencil size={16} className="mr-2" /> {t("groups.edit")}
                    </Button>
                    <TooltipProvider delayDuration={100}>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="inline-block">
                            <Button
                              variant={"outline"}
                              aria-label={t("groups.remove_member")}
                              className="text-red-500 border-red-500 hover:bg-red-500 hover:text-white"
                              onClick={handleDeleteClick}
                              disabled={isPassHolder}
                            >
                              <Trash2 size={16} className="mr-2" />{" "}
                              {t("groups.remove")}
                            </Button>
                          </div>
                        </TooltipTrigger>
                        {isPassHolder && (
                          <TooltipContent
                            side="top"
                            className="bg-gray-800 text-white px-3 py-2 rounded shadow-lg z-50"
                          >
                            <p>{t("groups.member_has_active_ticket")}</p>
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TooltipProvider>
                  </>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Modal for editing a member */}
      <MemberFormModal
        open={isEditModalOpen}
        onClose={handleModalClose}
        member={member}
        onSuccess={handleUpdateSuccess}
      />

      {/* Modal for confirming deletion */}
      <ConfirmDeleteModal
        open={isDeleteModalOpen}
        onClose={handleDeleteModalClose}
        member={member}
        onSuccess={handleDeleteSuccess}
      />
    </div>
  )
}

export default MemberItem
