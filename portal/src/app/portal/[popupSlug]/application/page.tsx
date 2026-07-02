"use client"

import { FileUploadProvider } from "@edgeos/shared-form-ui"
import { useRouter, useSearchParams } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { ApplicationPublic } from "@/client"
import { Loader } from "@/components/ui/Loader"
import { useApplicationSchema } from "@/hooks/useApplicationSchema"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { useFileUpload } from "../events/lib/useFileUpload"
import { DynamicApplicationForm } from "./components/dynamic-application-form"
import { ExistingApplicationCard } from "./components/existing-application-card"
import { FeePaymentBanner } from "./components/fee-payment-banner"
import { FormHeader } from "./components/form-header"
import { SectionSeparator } from "./components/section-separator"

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

  const {
    data: schema,
    isLoading: schemaLoading,
    isError,
  } = useApplicationSchema(city?.id)
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

  // Once submitted, the application is no longer accessible from the form —
  // same behavior as a fee-less submit. draft/pending_fee stay editable so the
  // applicant can still finish or retry the fee payment.
  useEffect(() => {
    if (
      application &&
      (application.status === "in review" ||
        application.status === "accepted" ||
        application.status === "rejected")
    ) {
      router.replace(`/portal/${city?.slug}`)
    }
  }, [application, city, router])

  useEffect(() => {
    if (city?.sale_type === "direct") {
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

  // Submitted or resolved applications never render the form. The effect above
  // redirects to the portal home; show a loader meanwhile to avoid flashing it.
  if (
    application?.status === "in review" ||
    application?.status === "accepted" ||
    application?.status === "rejected"
  ) {
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
      <FileUploadProvider value={uploadFile}>
        <DynamicApplicationForm
          key={existingApp?.id ?? importedData?.id ?? "new"}
          schema={schema}
          existingApplication={prefillData}
          popup={city}
        />
      </FileUploadProvider>
    </main>
  )
}
