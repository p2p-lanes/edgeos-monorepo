"use client"

import { AnimatePresence } from "framer-motion"
import { useEffect } from "react"
import { useCheckout } from "@/providers/checkoutProvider"
import type { AttendeeCategory } from "@/types/Attendee"
import type { CheckoutStep } from "@/types/checkout"
import CartFooter from "./CartFooter"
import CheckoutSkeleton from "./CheckoutSkeleton"
import ConfirmStep from "./steps/ConfirmStep"
import HousingStep from "./steps/HousingStep"
import MerchSection from "./steps/MerchSection"
import PassSelectionSection from "./steps/PassSelectionSection"
import PatronSection from "./steps/PatronSection"
import SuccessStep from "./steps/SuccessStep"

function getStepTitle(step: CheckoutStep): string {
  switch (step) {
    case "passes":
      return "Select Your Passes"
    case "housing":
      return "Choose Housing"
    case "merch":
      return "Event Merchandise"
    case "patron":
      return "Become a Patron"
    case "confirm":
      return "Review & Confirm"
    case "success":
      return ""
    default:
      return ""
  }
}

function getStepSubtitle(step: CheckoutStep): string {
  switch (step) {
    case "passes":
      return "Choose passes for yourself and family members"
    case "housing":
      return "Optional: Book accommodation for your stay"
    case "merch":
      return "Optional: Pick up exclusive merch at the event"
    case "patron":
      return "Optional: Support the community with a contribution"
    case "confirm":
      return "Review your order before payment"
    case "success":
      return ""
    default:
      return ""
  }
}

interface CheckoutFlowProps {
  onAddAttendee?: (category: AttendeeCategory) => void
  onPaymentComplete?: () => void
  onBack?: () => void
  isLoading?: boolean
}

export default function CheckoutFlow({
  onAddAttendee,
  onPaymentComplete,
  onBack,
  isLoading = false,
}: CheckoutFlowProps) {
  const {
    currentStep,
    availableSteps,
    goToNextStep,
    goToPreviousStep,
    housingProducts,
    merchProducts,
    patronProducts,
    submitPayment,
  } = useCheckout()

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on step change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" })
  }, [currentStep])

  const handleSkip = () => {
    goToNextStep()
  }

  const handleBack = () => {
    const currentIndex = availableSteps.indexOf(currentStep)
    if (currentIndex > 0) {
      goToPreviousStep()
    } else if (onBack) {
      onBack()
    }
  }

  const handlePayment = async () => {
    const result = await submitPayment()
    if (result.success) {
      onPaymentComplete?.()
    }
  }

  const renderStepContent = () => {
    switch (currentStep) {
      case "passes":
        return (
          <AnimatePresence mode="wait">
            {isLoading ? (
              <CheckoutSkeleton key="skeleton" />
            ) : (
              <PassSelectionSection
                key="passes"
                onAddAttendee={onAddAttendee}
              />
            )}
          </AnimatePresence>
        )
      case "housing":
        return housingProducts.length > 0 ? (
          <HousingStep onSkip={handleSkip} />
        ) : null
      case "merch":
        return merchProducts.length > 0 ? (
          <MerchSection onSkip={handleSkip} />
        ) : null
      case "patron":
        return patronProducts.length > 0 ? (
          <PatronSection onSkip={handleSkip} />
        ) : null
      case "confirm":
        return <ConfirmStep />
      case "success":
        return <SuccessStep />
      default:
        return null
    }
  }

  const showHeader = currentStep !== "success"
  const showFooter = currentStep !== "success"

  return (
    <div className="flex flex-col bg-[#F5F5F7] font-sans text-gray-900 rounded-lg">
      <main className="flex-1 max-w-md lg:max-w-2xl mx-auto px-4 pt-6 pb-4 w-full">
        {showHeader && (
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              {getStepTitle(currentStep)}
            </h1>
            <p className="text-gray-500 mt-1">{getStepSubtitle(currentStep)}</p>
          </div>
        )}

        {renderStepContent()}
      </main>

      {showFooter && (
        <div className="sticky bottom-0 w-full z-30">
          <div className="max-w-md lg:max-w-2xl mx-auto px-4">
            <CartFooter onPay={handlePayment} onBack={handleBack} />
          </div>
        </div>
      )}
    </div>
  )
}
