import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useCallback } from "react"

import {
  onboardingDismissedKey,
  TrialOnboarding,
} from "@/components/Dashboard/TrialOnboarding"
import { Skeleton } from "@/components/ui/skeleton"
import { useCurrentTenant } from "@/hooks/useCurrentTenant"

export const Route = createFileRoute("/_layout/onboarding")({
  component: OnboardingPage,
  head: () => ({
    meta: [{ title: "Onboarding - EdgeOS" }],
  }),
})

// The Onboarding section — default landing for free-trial tenants (see the
// redirect in `/`), but always reachable from the sidebar so organizers can
// come back to the checklist after skipping to the dashboard.
function OnboardingPage() {
  const navigate = useNavigate()
  const { data: tenant, isLoading } = useCurrentTenant()

  // "Skip for now" / "Go to dashboard": remember the dismissal (so `/` stops
  // redirecting here) and head to the dashboard.
  const handleSkip = useCallback(() => {
    if (tenant?.id) {
      localStorage.setItem(onboardingDismissedKey(tenant.id), "1")
    }
    navigate({ to: "/" })
  }, [tenant?.id, navigate])

  if (isLoading || !tenant) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  return <TrialOnboarding tenant={tenant} onSkip={handleSkip} />
}
