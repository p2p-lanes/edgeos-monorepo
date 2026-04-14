"use client"

import { AnimatePresence } from "framer-motion"
import { useSearchParams } from "next/navigation"
import { useEffect, useMemo } from "react"
import CartFooter from "@/components/checkout-flow/CartFooter"
import DynamicProductStep from "@/components/checkout-flow/DynamicProductStep"
import {
  STEP_COMPONENT_REGISTRY,
  shouldUseDynamicStep,
} from "@/components/checkout-flow/registries/stepRegistry"
import PassSelectionSection from "@/components/checkout-flow/steps/PassSelectionSection"
import SuccessStep from "@/components/checkout-flow/steps/SuccessStep"
import { usePaymentVerification } from "@/hooks/checkout"
import { useApplication } from "@/providers/applicationProvider"
import { useCheckout } from "@/providers/checkoutProvider"
import type { CheckoutStep } from "@/types/checkout"
import CheckoutSkeleton from "./CheckoutSkeleton"

// Fallback titles/subtitles when stepConfigs aren't loaded yet
function getDefaultStepTitle(step: CheckoutStep): string {
  switch (step) {
    case "passes":
    case "tickets":
      return "Select Your Passes"
    case "housing":
      return "Choose Housing"
    case "merch":
      return "Pop-up Merchandise"
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
      return "Optional: Pick up exclusive merch at the pop-up"
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
  onPaymentComplete?: () => void
  onBack?: () => void
  isLoading?: boolean
}

export default function CheckoutFlow({
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
    // Passes/tickets: dynamic step or fall-back legacy section
    if (currentStep === "passes" || currentStep === "tickets") {
      const ticketStepConfig = stepConfigs.find(
        (s) =>
          s.step_type === currentStep ||
          (s.step_type === "tickets" && currentStep === "passes"),
      )
      if (shouldUseDynamicStep(ticketStepConfig)) {
        return (
          <AnimatePresence mode="wait">
            {isLoading ? (
              <CheckoutSkeleton key="skeleton" />
            ) : (
              <DynamicProductStep
                key="passes"
                stepConfig={ticketStepConfig!}
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
            <PassSelectionSection key="passes" />
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

    // Check if the step should use a dynamic template
    const dynamicStepConfig = stepConfigs.find(
      (s) => s.step_type === currentStep,
    )
    if (shouldUseDynamicStep(dynamicStepConfig)) {
      return (
        <AnimatePresence mode="wait">
          {isLoading ? (
            <CheckoutSkeleton key="skeleton" />
          ) : (
            <DynamicProductStep
              key={currentStep}
              stepConfig={dynamicStepConfig!}
              onSkip={handleSkip}
            />
          )}
        </AnimatePresence>
      )
    }

    // Fallback: registry lookup for hardcoded components
    const StepComponent = STEP_COMPONENT_REGISTRY[currentStep]
    if (StepComponent) {
      return <StepComponent onSkip={handleSkip} />
    }

    // Unknown step with config: try dynamic as last resort
    if (dynamicStepConfig) {
      return (
        <DynamicProductStep
          stepConfig={dynamicStepConfig}
          onSkip={handleSkip}
        />
      )
    }

    return null
  }

  const showHeader = currentStep !== "success"
  const showFooter = currentStep !== "success"

  return (
    <div className="flex flex-col bg-[#F5F5F7] font-sans text-body rounded-lg">
      <main className="flex-1 max-w-md lg:max-w-2xl mx-auto px-4 pt-6 pb-4 w-full">
        {showHeader && (
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-heading">
              {stepTitle}
            </h1>
            <p className="text-heading-secondary mt-1">{stepSubtitle}</p>
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
