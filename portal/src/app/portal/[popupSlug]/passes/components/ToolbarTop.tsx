import { Newspaper, PlusIcon } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import useAttendee from "@/hooks/useAttendee"
import { useAttendeeCategories } from "@/hooks/useAttendeeCategories"
import { resolveCategoryLabel } from "@/lib/attendee-category-label"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import type { AttendeePassState } from "@/types/Attendee"
import useModal from "../hooks/useModal"
import { AttendeeModal } from "./AttendeeModal"
import EditPassesButton from "./common/Buttons/EditPassesButton"
import DiscountCode from "./common/DiscountCode"
import InvoiceModal from "./common/InvoiceModal"

interface ToolbarTopProps {
  canEdit?: boolean
  viewInvoices?: boolean
  positionCoupon?: "top" | "bottom" | "right"
  onSwitchToBuy?: () => void
  allows_coupons?: boolean
}

const ToolbarTop = ({
  canEdit = false,
  viewInvoices = true,
  positionCoupon = "bottom",
  onSwitchToBuy,
  allows_coupons = true,
}: ToolbarTopProps) => {
  const { t } = useTranslation()
  const { getAttendees } = useApplication()
  const { handleOpenModal, handleCloseModal, modal } = useModal()
  const { addAttendee } = useAttendee()
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false)
  const { getCity } = useCityProvider()
  const city = getCity()

  const { categories } = useAttendeeCategories(city?.id ? String(city.id) : "")

  const attendees = getAttendees()

  // Check if current date is before city start_date
  const canEditDate = city?.start_date
    ? new Date() < new Date(city.start_date)
    : true

  // Filter to non-primary categories that are enabled in passes flow
  const passesCategories = (categories ?? [])
    .filter((c) => c.enabled_in_passes_flow && !c.is_primary)
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))

  const handleSubmit = async (
    data: AttendeePassState & { category_id?: string },
  ) => {
    if (modal.category) {
      await addAttendee({
        name: data.name ?? "",
        email: data.email ?? "",
        category_id: modal.category.id,
        gender: data.gender ?? "",
      })
    }
    handleCloseModal()
  }

  return (
    <div className="flex justify-between w-full flex-wrap gap-2">
      <div className="flex gap-2 flex-wrap">
        {passesCategories.map((cat) => (
          <Button
            key={cat.id}
            variant="outline"
            className="bg-card text-foreground hover:bg-card hover:shadow-md transition-all"
            disabled={!attendees.length}
            onClick={() => handleOpenModal(cat)}
          >
            <PlusIcon className="h-4 w-4 mr-2" />
            {resolveCategoryLabel(cat, t)}
          </Button>
        ))}

        {modal.isOpen && modal.category && (
          <AttendeeModal
            open={modal.isOpen}
            onClose={handleCloseModal}
            onSubmit={handleSubmit}
            category={modal.category}
            editingAttendee={modal.editingAttendee}
          />
        )}
      </div>

      <div className="flex gap-2 items-center">
        {canEdit && canEditDate && (
          <EditPassesButton onSwitchToBuy={onSwitchToBuy} />
        )}
        {viewInvoices && city?.invoice_company_name && (
          <>
            <Button
              variant={"ghost"}
              onClick={() => setIsInvoiceModalOpen(true)}
            >
              <Newspaper className="h-4 w-4" />
              <p className="text-sm font-medium hidden md:block">
                {t("passes.view_invoices")}
              </p>
            </Button>
            <InvoiceModal
              isOpen={isInvoiceModalOpen}
              onClose={() => setIsInvoiceModalOpen(false)}
            />
          </>
        )}

        {positionCoupon === "right" && allows_coupons && (
          <div className="ml-2">
            <DiscountCode defaultOpen={true} label={false} />
          </div>
        )}
      </div>
    </div>
  )
}

export default ToolbarTop
