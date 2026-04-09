"use client"

import { useParams, useRouter } from "next/navigation"
import ScrollyCheckoutFlow from "@/components/checkout-flow/ScrollyCheckoutFlow"
import { Loader } from "@/components/ui/Loader"
import useAttendee from "@/hooks/useAttendee"
import { CheckoutProvider } from "@/providers/checkoutProvider"
import PassesProvider, { usePassesProvider } from "@/providers/passesProvider"
import type { AttendeeCategory, AttendeePassState } from "@/types/Attendee"
import { AttendeeModal } from "../components/AttendeeModal"
import useModal from "../hooks/useModal"
import usePermission from "../hooks/usePermission"

export default function BuyPassesPage() {
  usePermission()

  const params = useParams()
  const router = useRouter()
  const { attendeePasses: attendees, products } = usePassesProvider()
  const { handleOpenModal, handleCloseModal, modal } = useModal()
  const { addAttendee } = useAttendee()

  const handleBack = () => {
    router.push(`/portal/${params.popupSlug}/passes`)
  }

  const handleAddAttendee = (category: AttendeeCategory) => {
    handleOpenModal(category)
  }

  const handleSubmitAttendee = async (data: AttendeePassState) => {
    if (modal.category) {
      await addAttendee({
        name: data.name ?? "",
        email: data.email ?? "",
        category: modal.category,
        gender: data.gender ?? "",
      })
    }
    handleCloseModal()
  }

  if (!attendees.length || !products.length) return <Loader />

  return (
    <div className="w-full md:mt-0 mx-auto items-center max-w-3xl ">
      <PassesProvider restoreFromCart>
        <CheckoutProvider initialStep="passes">
          <ScrollyCheckoutFlow
            onBack={handleBack}
            onAddAttendee={handleAddAttendee}
            onPaymentComplete={() => {}}
          />
        </CheckoutProvider>
      </PassesProvider>

      {modal.isOpen && (
        <AttendeeModal
          open={modal.isOpen}
          onClose={handleCloseModal}
          onSubmit={handleSubmitAttendee}
          category={modal.category!}
          editingAttendee={modal.editingAttendee}
        />
      )}
    </div>
  )
}
