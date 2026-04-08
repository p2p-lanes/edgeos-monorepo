"use client"

import { AnimatePresence } from "framer-motion"
import { useSearchParams } from "next/navigation"
import { useEffect, useMemo } from "react"
import { usePaymentVerification } from "@/hooks/checkout"
import { useApplication } from "@/providers/applicationProvider"
import { useCheckout } from "@/providers/checkoutProvider"
import type { AttendeeCategory } from "@/types/Attendee"
import type { CheckoutStep } from "@/types/checkout"
import CartFooter from "./CartFooter"
import CheckoutSkeleton from "./CheckoutSkeleton"
import DynamicProductStep from "./DynamicProductStep"
import { STEP_COMPONENT_REGISTRY } from "./stepRegistry"
import PassSelectionSection from "./steps/PassSelectionSection"
import SuccessStep from "./steps/SuccessStep"

// Fallback titles/subtitles when stepConfigs aren't loaded yet
function getDefaultStepTitle(step: CheckoutStep): string {
  switch (step) {
    case "passes":
    case "tickets":
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

function getDefaultStepSubtitle(step: CheckoutStep): string {
  switch (step) {
    case "passes":
    case "tickets":
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
    stepConfigs,
    goToNextStep,
    goToPreviousStep,
    goToStep,
    housingProducts,
    merchProducts,
    patronProducts,
    submitPayment,
  } = useCheckout()

  const searchParams = useSearchParams()
  const { getRelevantApplication } = useApplication()
  const application = getRelevantApplication()

  // Verify payment status when returning from SimpleFI redirect
  const isSimpleFIReturn = useMemo(
    () => searchParams.has("checkout", "success"),
    [searchParams],
  )

  // Navigate to success step when returning from Stripe redirect
  useEffect(() => {
    if (isSimpleFIReturn && currentStep !== "success") {
      goToStep("success")
    }
  }, [isSimpleFIReturn, currentStep, goToStep])

  const { paymentStatus } = usePaymentVerification({
    applicationId: application?.id,
    enabled: isSimpleFIReturn && currentStep === "success",
  })

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

  // Lookup API-driven title/subtitle for current step.
  // API step_type "tickets" corresponds to internal "passes".
  const stepConfig = stepConfigs.find(
    (s) =>
      s.step_type === currentStep ||
      (s.step_type === "tickets" && currentStep === "passes"),
  )

  const stepTitle = stepConfig?.title ?? getDefaultStepTitle(currentStep)
  const stepSubtitle =
    stepConfig?.description ?? getDefaultStepSubtitle(currentStep)

  const renderStepContent = () => {
    // Passes/tickets step — use DynamicProductStep if template_config exists,
    // otherwise fall back to PassSelectionSection
    if (currentStep === "passes" || currentStep === "tickets") {
      const ticketStepConfig = stepConfigs.find(
        (s) =>
          s.step_type === currentStep ||
          (s.step_type === "tickets" && currentStep === "passes"),
      )
      if (ticketStepConfig?.template_config) {
        return (
          <AnimatePresence mode="wait">
            {isLoading ? (
              <CheckoutSkeleton key="skeleton" />
            ) : (
              <DynamicProductStep
                key="passes"
                stepConfig={ticketStepConfig}
                onSkip={handleSkip}
              />
            )}
          </AnimatePresence>
        )
      }
      return (
        <AnimatePresence mode="wait">
          {isLoading ? (
            <CheckoutSkeleton key="skeleton" />
          ) : (
            <PassSelectionSection key="passes" onAddAttendee={onAddAttendee} />
          )}
        </AnimatePresence>
      )
    }

    // Success step has special paymentStatus prop
    if (currentStep === "success") {
      return (
        <SuccessStep
          paymentStatus={isSimpleFIReturn ? paymentStatus : "approved"}
        />
      )
    }

    // Product-availability guards for optional steps
    if (currentStep === "housing" && housingProducts.length === 0) return null
    if (currentStep === "merch" && merchProducts.length === 0) return null
    if (currentStep === "patron" && patronProducts.length === 0) return null

    // If the step has a template_config, use DynamicProductStep
    // instead of the legacy hardcoded component
    const dynamicStepConfig = stepConfigs.find(
      (s) => s.step_type === currentStep,
    )
    const dynamicConfig = dynamicStepConfig?.template_config as
      | Record<string, unknown>
      | undefined
    const housingUseDynamic =
      currentStep === "housing" &&
      dynamicConfig &&
      ((dynamicConfig.variant && dynamicConfig.variant !== "default") ||
        (Array.isArray(dynamicConfig.sections) &&
          dynamicConfig.sections.length > 0))
    const hasTemplateConfig =
      currentStep !== "housing" && dynamicStepConfig?.template_config
    if (dynamicStepConfig && (housingUseDynamic || hasTemplateConfig)) {
      return (
        <AnimatePresence mode="wait">
          {isLoading ? (
            <CheckoutSkeleton key="skeleton" />
          ) : (
            <DynamicProductStep
              key={currentStep}
              stepConfig={dynamicStepConfig}
              onSkip={handleSkip}
            />
          )}
        </AnimatePresence>
      )
    }

    // Registry lookup — covers housing, merch, patron,
    // and any future step types added to STEP_COMPONENT_REGISTRY
    const StepComponent = STEP_COMPONENT_REGISTRY[currentStep]
    if (StepComponent) {
      return <StepComponent onSkip={handleSkip} />
    }

    // Custom step — render dynamically based on step config
    const currentStepConfig = stepConfigs.find(
      (s) => s.step_type === currentStep,
    )
    if (currentStepConfig) {
      return (
        <DynamicProductStep
          stepConfig={currentStepConfig}
          onSkip={handleSkip}
        />
      )
    }

    return null
  }

  const showHeader = currentStep !== "success"
  const showFooter = currentStep !== "success"

  return (
    <div className="flex flex-col bg-[#F5F5F7] font-sans text-gray-900 rounded-lg">
      <main className="flex-1 max-w-md lg:max-w-2xl mx-auto px-4 pt-6 pb-4 w-full">
        {showHeader && (
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              {stepTitle}
            </h1>
            <p className="text-gray-500 mt-1">{stepSubtitle}</p>
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
