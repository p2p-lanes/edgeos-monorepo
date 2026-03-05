"use client"

import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useState } from "react"
import CheckoutFlow from "@/app/checkout/components/CheckoutFlow"
import { Loader } from "@/components/ui/Loader"
import useAttendee from "@/hooks/useAttendee"
import { usePassesProvider } from "@/providers/passesProvider"
import { CheckoutProvider } from "@/providers/checkoutProvider"
import type { AttendeeCategory, AttendeePassState } from "@/types/Attendee"
import type { CheckoutStep } from "@/types/checkout"
import usePermission from "../hooks/usePermission"
import useModal from "../hooks/useModal"
import { AttendeeModal } from "../components/AttendeeModal"

export default function BuyPassesPage() {
  usePermission()

  const params = useParams()
  const router = useRouter()
  const searchParams = useSearchParams()
  const { attendeePasses: attendees, products } = usePassesProvider()
  const { handleOpenModal, handleCloseModal, modal } = useModal()
  const { addAttendee } = useAttendee()

  const isCheckoutSuccess = searchParams.has("checkout", "success")
  const initialStep: CheckoutStep = isCheckoutSuccess ? "success" : "passes"

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
    <div className="w-full md:mt-0 mx-auto items-center max-w-3xl bg-[#F5F5F7]">
      <CheckoutProvider initialStep={initialStep}>
        <CheckoutFlow
          onBack={handleBack}
          onAddAttendee={handleAddAttendee}
          onPaymentComplete={() => {}}
        />
      </CheckoutProvider>

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
