"use client"

import { useEffect, useRef } from "react"
import { trackGACheckoutStep } from "@/lib/google-analytics"

export interface TrackableCheckoutStep {
  id: string
  stepType: string
  label: string
  config?: { step_type: string } | null
}

interface CheckoutStepTrackingPopup {
  id: string
  slug: string
  name?: string | null
}

interface UseCheckoutStepTrackingParams {
  activeStepId: string | null | undefined
  sections: TrackableCheckoutStep[]
  popup: CheckoutStepTrackingPopup | null | undefined
  enabled?: boolean
}

/**
 * Track entry into the active checkout step.
 *
 * Re-renders while the same step remains active are ignored. A genuine revisit
 * (A → B → A) is emitted again because it represents another step entry. The
 * popup id is part of the transition key so switching checkout runtimes in the
 * same mounted tree starts a fresh funnel.
 */
export function useCheckoutStepTracking({
  activeStepId,
  sections,
  popup,
  enabled = true,
}: UseCheckoutStepTrackingParams) {
  const previousEntryKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !activeStepId || !popup?.id || !popup.slug) return

    const stepIndex = sections.findIndex(
      (section) => section.id === activeStepId,
    )
    if (stepIndex < 0) return

    const step = sections[stepIndex]
    const entryKey = `${popup.id}:${step.id}`
    if (previousEntryKeyRef.current === entryKey) return

    trackGACheckoutStep({
      popup,
      stepNumber: stepIndex + 1,
      stepId: step.id,
      stepType: step.config?.step_type ?? step.stepType,
      stepName: step.label,
    })
    previousEntryKeyRef.current = entryKey
  }, [activeStepId, enabled, popup, sections])
}
