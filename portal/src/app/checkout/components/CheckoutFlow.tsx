"use client"

import { AnimatePresence } from "framer-motion"
import { useSearchParams } from "next/navigation"
import { useEffect, useMemo } from "react"
import { useTranslation } from "react-i18next"
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

type Translator = (key: string) => string

// Fallback titles/subtitles when stepConfigs aren't loaded yet
function getDefaultStepTitle(step: CheckoutStep, t: Translator): string {
  switch (step) {
    case "passes":
    case "tickets":
      return t("checkout.steps.passes_title")
    case "housing":
      return t("checkout.steps.housing_title")
    case "merch":
      return t("checkout.steps.merch_title")
    case "patron":
      return t("checkout.steps.patron_title")
    case "confirm":
      return t("checkout.steps.confirm_title")
    case "success":
      return ""
    default:
      return ""
  }
}

function getDefaultStepSubtitle(step: CheckoutStep, t: Translator): string {
  switch (step) {
    case "passes":
    case "tickets":
      return t("checkout.steps.passes_subtitle")
    case "housing":
      return t("checkout.steps.housing_subtitle")
    case "merch":
      return t("checkout.steps.merch_subtitle")
    case "patron":
      return t("checkout.steps.patron_subtitle")
    case "confirm":
      return t("checkout.steps.confirm_subtitle")
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
  const { t } = useTranslation()
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

  const stepTitle = stepConfig?.title ?? getDefaultStepTitle(currentStep, t)
  const stepSubtitle =
    stepConfig?.description ?? getDefaultStepSubtitle(currentStep, t)

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
