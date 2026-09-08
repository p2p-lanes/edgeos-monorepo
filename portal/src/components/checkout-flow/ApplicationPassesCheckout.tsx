"use client"

import Link from "next/link"
import { useParams, useRouter } from "next/navigation"
import { useTranslation } from "react-i18next"
import { CheckoutBackgroundImage } from "@/components/CheckoutBackgroundImage"
import { CheckoutBackgroundVideo } from "@/components/CheckoutBackgroundVideo"
import { Loader } from "@/components/ui/Loader"
import { useApplicationsQuery } from "@/hooks/useGetApplications"
import useHumanAttendeesQuery from "@/hooks/useHumanAttendeesQuery"
import { useHumanPopupAccess } from "@/hooks/useHumanPopupAccess"
import useResolvedAttendees from "@/hooks/useResolvedAttendees"
import { getCheckoutBackground } from "@/lib/background-image"
import { useApplication } from "@/providers/applicationProvider"
import { CheckoutProvider } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import PassesProvider from "@/providers/passesProvider"
import { SessionRecovery } from "@/providers/sessionProvider"
import ScrollyCheckoutFlow from "./ScrollyCheckoutFlow"

export function ApplicationPassesCheckout({
  flowId,
  flowSlug,
}: {
  flowId: string
  flowSlug: string
}) {
  const params = useParams<{ popupSlug: string }>()
  const router = useRouter()
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const city = getCity()
  const popupId = city?.id ? String(city.id) : null
  const { getRelevantApplication } = useApplication()
  const applications = useApplicationsQuery()
  const attendeesQuery = useHumanAttendeesQuery(popupId)
  const attendees = useResolvedAttendees(flowId)
  const access = useHumanPopupAccess(popupId)
  const application = getRelevantApplication(flowId)
  const background = getCheckoutBackground(city, "passes")
  const loading = applications.isLoading || access.state === "loading"
  const approved =
    application?.status === "accepted" && access.state === "allowed"

  // Start the scoped catalog and cart without the outer popup-wide products gate.
  // Checkout side effects wait for the application's identity and access result.
  return (
    <PassesProvider
      key={`${popupId}:${flowId}`}
      attendees={attendees}
      restoreFromCart
      flowType="application"
      salesFlowId={flowId}
    >
      {access.state === "unavailable" ? (
        <SessionRecovery onRetry={access.retry} />
      ) : loading ? (
        <Loader />
      ) : !approved ? (
        <section className="mx-auto max-w-5xl p-6">
          <h1 className="text-2xl font-semibold">
            {t("shop.approval_required_title")}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("shop.approval_required_description")}
          </p>
          <Link
            href={`/portal/${params.popupSlug}?flow=${flowId}`}
            className="mt-6 inline-flex text-sm font-medium text-primary hover:underline"
          >
            {t("shop.approval_required_cta")}
          </Link>
        </section>
      ) : (
        <CheckoutProvider
          initialStep="passes"
          salesFlowId={flowId}
          salesFlowSlug={flowSlug}
          flowType="application"
        >
          <div className="relative isolate min-h-full w-full bg-background">
            {background.type === "image" && (
              <CheckoutBackgroundImage
                url={background.url}
                position="absolute"
              />
            )}
            {background.type === "video" && (
              <CheckoutBackgroundVideo
                url={background.url}
                position="absolute"
              />
            )}
            {attendeesQuery.isLoading ? (
              <Loader />
            ) : (
              <ScrollyCheckoutFlow
                onBack={() =>
                  router.push(
                    `/portal/${params.popupSlug}/passes?flow=${flowId}`,
                  )
                }
                onPaymentComplete={() => {}}
              />
            )}
          </div>
        </CheckoutProvider>
      )}
    </PassesProvider>
  )
}
