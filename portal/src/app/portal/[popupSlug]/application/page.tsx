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
import { shouldRedirectToStatus } from "./lib/shouldRedirectToStatus"

function useFormInitData() {
  const { getCity, getPopups } = useCityProvider()
  const { applications, getRelevantApplication } = useApplication()
  const city = getCity()
  const popups = getPopups()
  const application = getRelevantApplication()

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
  const application = getRelevantApplication()
  const router = useRouter()
  const searchParams = useSearchParams()
  // Capture once on mount so a later URL change doesn't tear down the fee
  // banner while it's still polling for the payment webhook.
  const [isReturnFromCheckout] = useState(() =>
    searchParams.has("checkout", "success"),
  )
  // Referral UUID carried from /r/{code} consumption page (REQ-GR-009)
  const referralId = searchParams.get("referral_id")

  // sdd/sales-flows task 9.4: the FlowPicker is shown only when a popup has
  // more than one portal-listed application flow — `needsFlowChoice` gates
  // the form until the visitor picks one. Single/zero-flow popups never
  // set it (FlowPicker renders nothing and auto-selects internally), so
  // this is a no-op for the common case.
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null)
  // Resolved independently of the <FlowPicker> element below (not via its
  // onResolved callback): the terminal-status guards further down need this
  // before we know whether it's even safe to reach the JSX that mounts
  // FlowPicker. Same query, shared cache — no extra request.
  const { data: portalFlows } = usePortalSalesFlows(city?.id)
  // `null` = not resolved yet (never gates a redirect). Deliberately still
  // a flow-COUNT heuristic, not an `application.sales_flow_id` lookup:
  // ApplicationPublic exposes sales_flow_id as of slice 14, but a terminal
  // `application` fetched here is resolved by human+popup, independent of
  // FlowPicker's (not-yet-made) selection — so even knowing the existing
  // application's flow doesn't tell us it's the SAME flow this visitor is
  // about to pick. Once a popup has more than one flow, redirecting on a
  // terminal status is unsafe until the visitor has chosen. Simplifying
  // this to a per-flow lookup was considered and deferred (task 14.x
  // backlog) — it would change what "terminal" means for a multi-flow
  // visitor, which is a product decision, not a mechanical refactor.
  const needsFlowChoice = portalFlows ? portalFlows.length > 1 : null

  const {
    data: schema,
    isLoading: schemaLoading,
    isError,
  } = useApplicationSchema(city?.id, selectedFlowId)
  const { application: existingApp, importSource } = useFormInitData()

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

  // Resolved applications are no longer accessible from the form.
  // draft/pending_fee/in review stay editable so the applicant can still finish,
  // retry the fee payment, or update details while the application is under review.
  // Gated on needsFlowChoice === false: only single/zero-flow popups have an
  // unambiguous `application` to redirect on (rel-002 correction) — for
  // multi-flow popups the FlowPicker must get a chance to mount instead.
  useEffect(() => {
    if (
      application &&
      shouldRedirectToStatus(needsFlowChoice, application.status)
    ) {
      router.replace(`/portal/${city?.slug}`)
    }
  }, [application, city, router, needsFlowChoice])

  useEffect(() => {
    if (city?.sale_type === "direct") {
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

  if (city.sale_type === "direct") {
    return <Loader />
  }

  if (city.status === "ended") {
    return <Loader />
  }

  // Resolved applications never render the form. The effect above redirects to
  // the portal home; show a loader meanwhile to avoid flashing it. Same
  // needsFlowChoice === false gate as the effect (rel-002 correction).
  if (shouldRedirectToStatus(needsFlowChoice, application?.status)) {
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
        onSelect={setSelectedFlowId}
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
            needsFlowChoice={needsFlowChoice === true}
          />
        </FileUploadProvider>
      )}
    </main>
  )
}
