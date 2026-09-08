"use client"

import { FileUploadProvider } from "@edgeos/shared-form-ui"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { ApplicationPublic } from "@/client"
import { ApplicationUnavailable } from "@/components/Portal/ApplicationUnavailable"
import { Loader } from "@/components/ui/Loader"
import { useApplicationSchema } from "@/hooks/useApplicationSchema"
import { useApplicationsQuery } from "@/hooks/useGetApplications"
import { usePortalSalesFlows } from "@/hooks/usePortalSalesFlows"
import { useInitialQueryResolution } from "@/lib/initial-query-resolution"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { useFileUpload } from "../events/lib/useFileUpload"
import { DynamicApplicationForm } from "./components/dynamic-application-form"
import { ExistingApplicationCard } from "./components/existing-application-card"
import { FeePaymentBanner } from "./components/fee-payment-banner"
import { FormHeader } from "./components/form-header"
import { SectionSeparator } from "./components/section-separator"
import { resolveApplicationFlowId } from "./lib/resolveApplicationFlowId"
import { resolvedApplicationDestination } from "./lib/resolvedApplicationDestination"
import { shouldRedirectToStatus } from "./lib/shouldRedirectToStatus"

/**
 * @param application The application selected for the current way in.
 *   Without it,
 *   someone holding two applications would resume editing whichever the
 *   provider picked, and could overwrite the wrong one
 *   (sdd/sales-flows-rediseno).
 */
function useFormInitData(application: ApplicationPublic | null) {
  const { getCity, getPopups } = useCityProvider()
  const { applications } = useApplication()
  const city = getCity()
  const popups = getPopups()

  return useMemo(() => {
    if (!city || !applications) return { application: null, importSource: null }

    // If there's a draft/in-review for this popup, edit it
    if (application) {
      return { application, importSource: null }
    }

    // Otherwise, look for an accepted application from another popup to import
    const accepted = applications
      .filter((app) => app.status === "accepted" && app.popup_id !== city.id)
      .sort(
        (a, b) =>
          new Date(b.updated_at || "").getTime() -
          new Date(a.updated_at || "").getTime(),
      )

    // Prefer one from the most recent popup
    const sortedPopups = [...popups].sort(
      (a, b) =>
        new Date(b.end_date ?? "").getTime() -
        new Date(a.end_date ?? "").getTime(),
    )

    for (const popup of sortedPopups) {
      const match = accepted.find((app) => app.popup_id === popup.id)
      if (match) return { application: null, importSource: match }
    }

    return { application: null, importSource: null }
  }, [city, applications, application, popups])
}

export default function FormPage() {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const { getRelevantApplication } = useApplication()
  const applicationsQuery = useApplicationsQuery()
  const city = getCity()
  const router = useRouter()
  const searchParams = useSearchParams()
  // Capture once on mount so a later URL change doesn't tear down the fee
  // banner while it's still polling for the payment webhook.
  const [isReturnFromCheckout] = useState(() =>
    searchParams.has("checkout", "success"),
  )
  // Referral UUID carried from /r/{code} consumption page (REQ-GR-009)
  const referralId = searchParams.get("referral_id")

  // Which way into the gathering this form is for. Entry links carry a
  // readable flow slug; authenticated portal handoffs carry the internal id.
  // Both resolve to the id required by the application API.
  const flowIdentifier = searchParams.get("flow")
  const flowsQuery = usePortalSalesFlows(city?.id)
  const portalFlows = flowsQuery.data
  const applicationsLoading = useInitialQueryResolution(
    "applications",
    applicationsQuery,
  )
  const flowsLoading = useInitialQueryResolution(
    `application-flows:${city?.id ?? ""}`,
    flowsQuery,
  )
  const initialFlowsReady = !flowsLoading
  const selectedFlowId = useMemo(() => {
    if (!initialFlowsReady || !portalFlows) return null
    if (!flowIdentifier) {
      return portalFlows.length === 1 ? portalFlows[0].id : null
    }
    return resolveApplicationFlowId(flowIdentifier, portalFlows)
  }, [flowIdentifier, initialFlowsReady, portalFlows])
  // Declared after the door, not before it: asking which application this
  // is without saying which way in used to answer with whichever came last.
  const application = selectedFlowId
    ? getRelevantApplication(selectedFlowId)
    : null

  const {
    data: schema,
    isPending: schemaPending,
    isLoadingError: schemaLoadingError,
  } = useApplicationSchema(city?.id, selectedFlowId)
  const { application: existingApp, importSource } =
    useFormInitData(application)

  const [showImport, setShowImport] = useState(false)
  const [importedData, setImportedData] = useState<ApplicationPublic | null>(
    null,
  )

  // Show import dialog when import source is found
  useEffect(() => {
    if (importSource && !existingApp) {
      setShowImport(true)
    }
  }, [importSource, existingApp])

  useEffect(() => {
    if (
      !initialFlowsReady ||
      !city ||
      portalFlows === undefined ||
      selectedFlowId
    )
      return
    router.replace(`/portal/${city.slug}`)
  }, [city, initialFlowsReady, portalFlows, router, selectedFlowId])

  // Resolved applications are no longer accessible from the form.
  // draft/pending_fee/in review stay editable so the applicant can still
  // finish, retry the fee payment, or update details while under review.
  useEffect(() => {
    if (!application || !shouldRedirectToStatus(application.status)) return
    router.replace(resolvedApplicationDestination(city?.slug, application))
  }, [application, city, router])

  useEffect(() => {
    if (city?.takes_applications === false) {
      router.replace(`/portal/${city.slug}`)
    }
  }, [city, router])

  useEffect(() => {
    if (city?.status === "ended") {
      router.replace(`/portal/${city.slug}`)
    }
  }, [city, router])

  const { uploadFile } = useFileUpload()

  const handleImport = () => {
    if (importSource) {
      setImportedData(importSource)
      setShowImport(false)
      toast.success(t("application.import_success"))
    }
  }

  const handleCancelImport = () => {
    setShowImport(false)
  }

  if (applicationsLoading || flowsLoading || !city) {
    return <Loader />
  }

  if (applicationsQuery.isLoadingError || flowsQuery.isLoadingError) {
    return <ApplicationUnavailable />
  }

  if (!portalFlows || !selectedFlowId || schemaPending) return <Loader />

  if (city.takes_applications === false) {
    return <Loader />
  }

  if (city.status === "ended") {
    return <Loader />
  }

  // Resolved applications never render the form. The effect above
  // redirects to the portal home; show a loader meanwhile so it does not
  // flash. Same check as the effect, from the same function.
  if (shouldRedirectToStatus(application?.status)) {
    return <Loader />
  }

  // Returning from the fee checkout: show only the confirmation banner while we
  // poll for the payment webhook. The form must not reappear after paying.
  if (isReturnFromCheckout) {
    return (
      <main className="container py-6 md:py-12 mb-8 px-8 md:px-12">
        {application ? (
          <FeePaymentBanner application={application} isReturnFromCheckout />
        ) : (
          <Loader />
        )}
      </main>
    )
  }

  if (schemaLoadingError || !schema) return <ApplicationUnavailable />

  // Determine which data to pre-fill:
  // 1. Existing draft/in-review for this popup
  // 2. Imported data from accepted app in another popup
  const prefillData = existingApp ?? importedData

  return (
    <main className="container py-6 md:py-12 mb-8 px-8 md:px-12">
      {showImport && importSource && (
        <ExistingApplicationCard
          onImport={handleImport}
          onCancel={handleCancelImport}
          data={importSource}
        />
      )}
      <div className="space-y-8">
        <FormHeader />
        <SectionSeparator />
      </div>
      <FileUploadProvider value={uploadFile}>
        <DynamicApplicationForm
          key={`${selectedFlowId}:${existingApp?.id ?? importedData?.id ?? "new"}`}
          schema={schema}
          existingApplication={prefillData}
          popup={city}
          referralId={referralId}
          salesFlowId={selectedFlowId}
        />
      </FileUploadProvider>
    </main>
  )
}
