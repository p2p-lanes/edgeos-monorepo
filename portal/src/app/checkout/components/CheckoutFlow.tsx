"use client"

import { AnimatePresence } from "framer-motion"
import { useParams, useSearchParams } from "next/navigation"
import { useEffect, useState } from "react"
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
import { readAndClearPendingPaymentRedirectState } from "@/hooks/usePaymentRedirect"
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
    cart,
  } = useCheckout()

  const searchParams = useSearchParams()
  const params = useParams<{ popupSlug: string }>()
  const { getRelevantApplication } = useApplication()
  const application = getRelevantApplication()
  const [restoredPaymentId, setRestoredPaymentId] = useState<string | null>(
    null,
  )
  const [redirectStateRestored, setRedirectStateRestored] = useState(false)

  // Verify payment status when returning from SimpleFI redirect
  const isSimpleFIReturn = searchParams.get("checkout") === "success"

  useEffect(() => {
    if (!isSimpleFIReturn) {
      setRestoredPaymentId(null)
      setRedirectStateRestored(true)
      return
    }

    const redirectState = readAndClearPendingPaymentRedirectState()
    const paymentId =
      redirectState?.popupSlug === params.popupSlug
        ? redirectState.paymentId
        : null

    setRestoredPaymentId(paymentId)
    setRedirectStateRestored(true)
  }, [isSimpleFIReturn, params.popupSlug])

  // Navigate to success step when returning from Stripe redirect
  useEffect(() => {
    if (isSimpleFIReturn && currentStep !== "success") {
      goToStep("success")
    }
  }, [isSimpleFIReturn, currentStep, goToStep])

  const { paymentStatus } = usePaymentVerification({
    applicationId: application?.id,
    paymentId: restoredPaymentId ?? undefined,
    enabled:
      redirectStateRestored && isSimpleFIReturn && currentStep === "success",
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

  // On the confirm step we swap in empty-state copy when there's nothing in
  // the cart — "Review & Confirm / Review your order before payment" reads
  // as a promise the UI can't keep when the body is just an empty bag icon.
  const isConfirmEmpty =
    currentStep === "confirm" &&
    cart.passes.length === 0 &&
    !cart.housing &&
    cart.merch.length === 0 &&
    !cart.patron &&
    Object.values(cart.dynamicItems).every((items) => items.length === 0)

  const stepTitle = isConfirmEmpty
    ? t("checkout.steps.confirm_empty_title")
    : (stepConfig?.title ?? getDefaultStepTitle(currentStep, t))
  const stepSubtitle = isConfirmEmpty
    ? t("checkout.steps.confirm_empty_subtitle")
    : (stepConfig?.description ?? getDefaultStepSubtitle(currentStep, t))

  const renderStepContent = () => {
    // Passes/tickets: dynamic step or fall-back default section
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
          paymentStatus={
            isSimpleFIReturn && !redirectStateRestored
              ? "verifying"
              : isSimpleFIReturn
                ? paymentStatus
                : "approved"
          }
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
    <div className="flex flex-col font-sans rounded-lg">
      <main className="flex-1 max-w-md lg:max-w-2xl mx-auto px-4 pt-6 pb-4 w-full">
        {showHeader && (
          <div className="mb-6">
            <h1 className="text-2xl font-bold tracking-tight text-checkout-title">
              {stepTitle}
            </h1>
            <p className="text-checkout-subtitle mt-1">{stepSubtitle}</p>
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
