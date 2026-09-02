"use client"

import { FileUploadProvider } from "@edgeos/shared-form-ui"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { ApplicationPublic } from "@/client"
import { Loader } from "@/components/ui/Loader"
import { useApplicationSchema } from "@/hooks/useApplicationSchema"
import { usePortalSalesFlows } from "@/hooks/usePortalSalesFlows"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { useFileUpload } from "../events/lib/useFileUpload"
import { DynamicApplicationForm } from "./components/dynamic-application-form"
import { ExistingApplicationCard } from "./components/existing-application-card"
import { FlowPicker } from "./components/FlowPicker"
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
  const [flowSelection, setFlowSelection] = useState<{
    identifier: string | null
    flowId: string | null
  }>({ identifier: flowIdentifier, flowId: null })
  // A selection belongs only to the URL identifier that produced it. Reading
  // it through that identifier drops flow A synchronously when the mounted
  // page starts resolving flow B, before redirect effects can observe A.
  const selectedFlowId =
    flowSelection.identifier === flowIdentifier ? flowSelection.flowId : null
  // Declared after the door, not before it: asking which application this
  // is without saying which way in used to answer with whichever came last.
  const application =
    flowIdentifier && !selectedFlowId
      ? null
      : getRelevantApplication(selectedFlowId)
  // Resolved independently of the <FlowPicker> element below (not via its
  // onResolved callback): the terminal-status guards further down need this
  // before we know whether it's even safe to reach the JSX that mounts
  // FlowPicker. Same query, shared cache — no extra request.
  const { data: portalFlows } = usePortalSalesFlows(city?.id)
  useEffect(() => {
    if (!portalFlows) return
    const resolvedFlowId = resolveApplicationFlowId(flowIdentifier, portalFlows)
    setFlowSelection((current) => {
      if (resolvedFlowId) {
        if (
          current.identifier === flowIdentifier &&
          current.flowId === resolvedFlowId
        ) {
          return current
        }
        return { identifier: flowIdentifier, flowId: resolvedFlowId }
      }
      return current.identifier === flowIdentifier
        ? current
        : { identifier: flowIdentifier, flowId: null }
    })
  }, [flowIdentifier, portalFlows])
  // Whether a door still has to be picked before the form means anything.
  // Its only job now is holding the form back: without a door, the schema
  // query could show the wrong questions.
  //
  // It used to gate the terminal-status redirect too, because `application`
  // was resolved by human and gathering and might belong to another door —
  // redirecting on it could send someone away from a door they had not
  // applied through. That is decided per door now, so the redirect asks
  // about the status and nothing else. `null` while the flows load.
  const needsFlowChoice = portalFlows ? portalFlows.length > 1 : null

  const {
    data: schema,
    isLoading: schemaLoading,
    isError,
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

  // `?flow=` can name a way in that takes no applications — a direct-sale
  // flow, or one the organiser has since unlisted. The id was trusted on
  // sight, so the form rendered for a door the picker was still asking
  // about: an empty card with a Submit button under an unanswered question.
  // An id the picker does not offer is dropped, and the picker asks.
  useEffect(() => {
    if (!portalFlows || !selectedFlowId) return
    if (portalFlows.some((flow) => flow.id === selectedFlowId)) return
    setFlowSelection({ identifier: flowIdentifier, flowId: null })
  }, [flowIdentifier, portalFlows, selectedFlowId])

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

  if (schemaLoading || !city) {
    return <Loader />
  }

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

  if (isError || !schema) {
    return (
      <main className="container py-6 md:py-12 mb-8 px-8 md:px-12">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold">{t("application.unavailable")}</h2>
          <p className="text-heading-secondary">
            {t("application.unavailable_description")}
          </p>
        </div>
      </main>
    )
  }

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
      <FlowPicker
        popupId={city.id}
        selectedFlowId={selectedFlowId}
        onSelect={(flowId) =>
          setFlowSelection({ identifier: flowIdentifier, flowId })
        }
      />
      {needsFlowChoice && !selectedFlowId ? null : (
        <FileUploadProvider value={uploadFile}>
          <DynamicApplicationForm
            key={existingApp?.id ?? importedData?.id ?? "new"}
            schema={schema}
            existingApplication={prefillData}
            popup={city}
            referralId={referralId}
            salesFlowId={selectedFlowId}
          />
        </FileUploadProvider>
      )}
    </main>
  )
}
