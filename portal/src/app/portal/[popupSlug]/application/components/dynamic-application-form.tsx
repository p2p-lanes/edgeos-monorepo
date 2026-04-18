"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "framer-motion"
import { Info } from "lucide-react"
import { useRouter } from "next/navigation"
import { memo, useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { ApplicationPublic, PopupPublic } from "@/client"
import { ApplicationsService } from "@/client"
import { ButtonAnimated } from "@/components/ui/button"
import InputForm, { AddonInputForm } from "@/components/ui/Form/Input"
import SelectForm from "@/components/ui/Form/Select"
import { useApplicationFee } from "@/hooks/useApplicationFee"
import { splitForCreate, splitForUpdate } from "@/lib/form-data-splitter"
import { queryKeys } from "@/lib/query-keys"
import { useApplication } from "@/providers/applicationProvider"
import type {
  ApplicationFormSchema,
  FormFieldSchema,
  FormSectionKind,
} from "@/types/form-schema"
import { useApplicationForm } from "../hooks/use-application-form"
import { CompanionsSection, type CompanionWithId } from "./companions-section"
import { DynamicField } from "./fields/dynamic-field"
import { ProgressBar } from "./progress-bar"
import SectionWrapper from "./SectionWrapper"
import { ScholarshipSection } from "./scholarship-section"
import { SectionSeparator } from "./section-separator"

const animationProps = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: "auto" },
  exit: { opacity: 0, height: 0 },
  transition: { duration: 0.3, ease: "easeInOut" },
}

const FULL_WIDTH_TYPES = new Set([
  "textarea",
  "multiselect",
  "url",
  "select_cards",
])

function mapOptions(options?: string[]) {
  return (options ?? []).map((opt) => ({ value: opt, label: opt }))
}

interface BaseFieldProps {
  name: string
  field: FormFieldSchema
  value: unknown
  error?: string
  onChange: (name: string, value: unknown) => void
  displayGender: string
  handleGenderChange: (value: string) => void
  genderSpecifyValue: string
  genderSpecifyError?: string
}

const BaseField = memo(function BaseField({
  name,
  field,
  value,
  error,
  onChange,
  displayGender,
  handleGenderChange,
  genderSpecifyValue,
  genderSpecifyError,
}: BaseFieldProps) {
  const { t } = useTranslation()
  if (name === "telegram") {
    return (
      <AddonInputForm
        label={field.label}
        id="telegram"
        value={(value as string) ?? ""}
        onChange={(v) => onChange("telegram", v)}
        error={error}
        isRequired={field.required}
        subtitle={field.help_text}
        addon="@"
        placeholder={field.placeholder}
      />
    )
  }

  if (name === "gender") {
    return (
      <div className="flex flex-col gap-4 w-full">
        <SelectForm
          label={field.label}
          id="gender"
          value={displayGender}
          onChange={handleGenderChange}
          error={error}
          isRequired={field.required}
          options={mapOptions(field.options)}
        />
        <AnimatePresence>
          {displayGender === "Specify" && (
            <motion.div {...animationProps}>
              <InputForm
                isRequired
                label={t("form.gender_specify")}
                id="gender_specify"
                value={genderSpecifyValue}
                onChange={(v) => onChange("gender_specify", v)}
                error={genderSpecifyError}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div className={FULL_WIDTH_TYPES.has(field.type) ? "md:col-span-2" : ""}>
      <DynamicField
        name={name}
        field={field}
        value={value}
        error={error}
        onChange={onChange}
        hideLabelAndSubtitle={name === "info_not_shared"}
      />
    </div>
  )
})

interface DynamicApplicationFormProps {
  schema: ApplicationFormSchema
  existingApplication?: ApplicationPublic | null
  popup: PopupPublic
}

export function DynamicApplicationForm({
  schema,
  existingApplication,
  popup,
}: DynamicApplicationFormProps) {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { getRelevantApplication, updateApplication } = useApplication()
  const { createOrResume, isPending: isFeePaymentPending } = useApplicationFee()
  const application = getRelevantApplication()

  const { values, errors, handleChange, validate, progress } =
    useApplicationForm(schema, existingApplication, popup.id)

  // Companions are initialized from attendees. The form remounts via key
  // whenever existingApplication changes, so useState initial value is correct.
  const [companions, setCompanions] = useState<CompanionWithId[]>(() => {
    if (!existingApplication?.attendees?.length) return []
    return existingApplication.attendees
      .filter((a) => a.category === "spouse" || a.category === "kid")
      .map((a) => ({
        _id: a.id,
        name: a.name,
        category: a.category,
        email: a.email ?? undefined,
        gender: a.gender ?? undefined,
      }))
  })
  const [statusBtn, setStatusBtn] = useState({
    loadingDraft: false,
    loadingSubmit: false,
  })
  const feeAlreadyPaid = Boolean(
    existingApplication &&
      popup.requires_application_fee &&
      existingApplication.status !== "draft" &&
      existingApplication.status !== "pending_fee",
  )
  const showFeeNotice = popup.requires_application_fee && !feeAlreadyPaid
  const formattedApplicationFee = useMemo(() => {
    const amount = Number(popup.application_fee_amount ?? 0)
    if (Number.isNaN(amount) || amount <= 0) {
      return null
    }

    return amount.toFixed(2)
  }, [popup.application_fee_amount])
  const submitLabel = showFeeNotice
    ? t("application.pay_and_submit", {
        amount: formattedApplicationFee
          ? `$${formattedApplicationFee}`
          : "$0.00",
      })
    : t("common.submit")

  const submitMutation = useMutation({
    mutationFn: async (status: "draft" | "in review") => {
      const companionPayload = companions.map(({ _id, ...rest }) => rest)

      if (application?.id) {
        return ApplicationsService.updateMyApplication({
          popupId: popup.id,
          requestBody: splitForUpdate({ values, status, schema }),
        })
      }

      return ApplicationsService.createMyApplication({
        requestBody: splitForCreate({
          values,
          popupId: popup.id,
          companions: companionPayload,
          status,
          schema,
        }),
      })
    },
    onSuccess: (result) => {
      updateApplication(result)
      queryClient.invalidateQueries({ queryKey: queryKeys.applications.mine() })
    },
  })

  const handleSubmit = async (
    e: Parameters<NonNullable<React.ComponentProps<"form">["onSubmit"]>>[0],
  ) => {
    e.preventDefault()
    if (statusBtn.loadingSubmit || isFeePaymentPending) return
    setStatusBtn({ loadingDraft: false, loadingSubmit: true })

    const { isValid, errors: validationErrors } = validate(false)

    if (!isValid) {
      const fields = Object.keys(validationErrors).join(", ")
      toast.error(t("application.error_title"), {
        description: t("application.required_fields_error", { fields }),
      })
      setStatusBtn({ loadingDraft: false, loadingSubmit: false })
      return
    }

    try {
      const result = await submitMutation.mutateAsync("in review")

      if (result.status === "pending_fee") {
        const feePayment = await createOrResume(result.id)

        if (!feePayment.checkoutUrl) {
          throw new Error(t("application.fee.missing_checkout_url"))
        }

        window.location.href = feePayment.checkoutUrl
        return
      }

      toast.success(t("application.submitted_title"), {
        description: t("application.submitted_description"),
      })
      router.push(`/portal/${popup.slug}`)
    } catch {
      toast.error(t("application.submit_error_title"), {
        description: t("application.submit_error_description"),
      })
    }
    setStatusBtn({ loadingDraft: false, loadingSubmit: false })
  }

  const handleDraft = async () => {
    setStatusBtn({ loadingDraft: true, loadingSubmit: false })
    try {
      await submitMutation.mutateAsync("draft")
      toast.success(t("application.draft_saved_title"), {
        description: t("application.draft_saved_description"),
      })
    } catch {
      toast.error(t("application.draft_error_title"), {
        description: t("application.draft_error_description"),
      })
    }
    setStatusBtn({ loadingDraft: false, loadingSubmit: false })
  }

  // Handle gender specify logic
  const handleGenderChange = useCallback(
    (value: string) => {
      handleChange("gender", value)
      if (value !== "Specify") {
        handleChange("gender_specify", "")
      }
    },
    [handleChange],
  )

  // Resolve display gender for select
  const displayGender = useMemo(() => {
    const g = values.gender as string
    const genderField = schema.base_fields.gender
    if (g && genderField?.options && !genderField.options.includes(g))
      return "Specify"
    return g ?? ""
  }, [values.gender, schema.base_fields])

  // Single ordered list of sections: each block has base + custom fields, order follows schema.sections
  type SectionBlock = {
    id: string
    title: string
    subtitle?: string
    kind: FormSectionKind
    baseFields: [string, FormFieldSchema][]
    customFields: [string, FormFieldSchema][]
  }

  const mergedSections = useMemo(() => {
    const bySectionIdBase: Record<string, [string, FormFieldSchema][]> = {}
    const bySectionIdCustom: Record<string, [string, FormFieldSchema][]> = {}

    for (const [name, field] of Object.entries(schema.base_fields)) {
      const sectionId = field.section_id || "_unsectioned"
      if (!bySectionIdBase[sectionId]) bySectionIdBase[sectionId] = []
      bySectionIdBase[sectionId].push([name, field])
    }
    for (const [name, field] of Object.entries(schema.custom_fields)) {
      const sectionId = field.section_id || "_unsectioned"
      if (!bySectionIdCustom[sectionId]) bySectionIdCustom[sectionId] = []
      bySectionIdCustom[sectionId].push([`custom_${name}`, field])
    }

    const sortByPosition = (fields: [string, FormFieldSchema][]) =>
      fields.sort(([, a], [, b]) => (a.position ?? 0) - (b.position ?? 0))
    for (const fields of Object.values(bySectionIdBase)) sortByPosition(fields)
    for (const fields of Object.values(bySectionIdCustom))
      sortByPosition(fields)

    const result: SectionBlock[] = []
    const sortedSections = [...(schema.sections ?? [])].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    )

    // 1. Unsectioned base first
    if (bySectionIdBase._unsectioned?.length) {
      result.push({
        id: "_unsectioned_base",
        title: t("form.personal_info"),
        subtitle: t("form.personal_info_description"),
        kind: "standard",
        baseFields: bySectionIdBase._unsectioned,
        customFields: [],
      })
      delete bySectionIdBase._unsectioned
    }

    // 2. Schema sections in order (only include if has base or custom fields)
    for (const section of sortedSections) {
      const baseFields = bySectionIdBase[section.id] ?? []
      const customFields = bySectionIdCustom[section.id] ?? []
      if (baseFields.length === 0 && customFields.length === 0) continue
      result.push({
        id: section.id,
        title: section.label,
        subtitle: section.description ?? undefined,
        kind: section.kind,
        baseFields,
        customFields,
      })
      delete bySectionIdBase[section.id]
      delete bySectionIdCustom[section.id]
    }

    // 3. Unsectioned custom
    if (bySectionIdCustom._unsectioned?.length) {
      result.push({
        id: "_unsectioned_custom",
        title: t("form.additional_info"),
        kind: "standard",
        baseFields: [],
        customFields: bySectionIdCustom._unsectioned,
      })
      delete bySectionIdCustom._unsectioned
    }

    // 4. Remaining (section_id not in schema.sections)
    const remainingIds = new Set([
      ...Object.keys(bySectionIdBase),
      ...Object.keys(bySectionIdCustom),
    ])
    for (const id of remainingIds) {
      const baseFields = bySectionIdBase[id] ?? []
      const customFields = bySectionIdCustom[id] ?? []
      if (baseFields.length === 0 && customFields.length === 0) continue
      result.push({
        id,
        title: t("form.other"),
        kind: "standard",
        baseFields,
        customFields,
      })
    }

    return result
  }, [schema, t])

  return (
    <>
      <form
        noValidate
        onSubmit={handleSubmit}
        className="space-y-8 px-8 md:px-12"
      >
        {/* Sections in schema order (base + custom fields per section) */}
        {mergedSections.map(
          ({ id, title, subtitle, kind, baseFields, customFields }) => {
            if (kind === "companions") {
              return (
                <div key={id}>
                  <CompanionsSection
                    allowsSpouse={popup.allows_spouse ?? false}
                    allowsChildren={popup.allows_children ?? false}
                    companions={companions}
                    onCompanionsChange={setCompanions}
                  />
                </div>
              )
            }
            if (kind === "scholarship") {
              const scholarshipFields = Object.fromEntries(
                baseFields.map(([name, field]) => [name, field]),
              )
              return (
                <ScholarshipSection
                  key={id}
                  section={{ id, label: title, description: subtitle }}
                  fields={scholarshipFields}
                  scholarshipRequest={
                    (values.scholarship_request as boolean) ?? false
                  }
                  scholarshipDetails={
                    (values.scholarship_details as string) ?? ""
                  }
                  scholarshipVideoUrl={
                    (values.scholarship_video_url as string) ?? ""
                  }
                  detailsError={errors.scholarship_details}
                  videoUrlError={errors.scholarship_video_url}
                  onScholarshipRequestChange={(checked) => {
                    handleChange("scholarship_request", checked)
                    if (!checked) {
                      handleChange("scholarship_details", "")
                      handleChange("scholarship_video_url", "")
                    }
                  }}
                  onDetailsChange={(value) =>
                    handleChange("scholarship_details", value)
                  }
                  onVideoUrlChange={(value) =>
                    handleChange("scholarship_video_url", value)
                  }
                />
              )
            }
            return (
              <div key={id}>
                <SectionWrapper title={title} subtitle={subtitle}>
                  <div className="grid gap-4 sm:grid-cols-2">
                    {baseFields.map(([name, field]) => (
                      <BaseField
                        key={name}
                        name={name}
                        field={field}
                        value={values[name]}
                        error={errors[name]}
                        onChange={handleChange}
                        displayGender={displayGender}
                        handleGenderChange={handleGenderChange}
                        genderSpecifyValue={
                          (values.gender_specify as string) ?? ""
                        }
                        genderSpecifyError={errors.gender_specify}
                      />
                    ))}
                    {customFields.map(([name, field]) => (
                      <div
                        key={name}
                        className={
                          FULL_WIDTH_TYPES.has(field.type)
                            ? "md:col-span-2"
                            : ""
                        }
                      >
                        <DynamicField
                          name={name}
                          field={field}
                          value={values[name]}
                          error={errors[name]}
                          onChange={handleChange}
                        />
                      </div>
                    ))}
                  </div>
                </SectionWrapper>
                <SectionSeparator />
              </div>
            )
          },
        )}

        {/* Submit buttons */}
        <div className="flex w-full flex-col gap-6 pt-6">
          {showFeeNotice && formattedApplicationFee && (
            <div className="flex w-full items-start gap-3 rounded-lg border border-border bg-muted/40 p-4 text-sm text-foreground">
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div>
                <p className="font-semibold">
                  {t("application.fee.required_title")}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {t("application.fee.required_description", {
                    amount: formattedApplicationFee,
                  })}
                </p>
              </div>
            </div>
          )}
          <div className="flex w-full flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <ButtonAnimated
              loading={statusBtn.loadingDraft}
              disabled={statusBtn.loadingSubmit}
              variant="outline"
              type="button"
              onClick={handleDraft}
              className="w-full md:w-auto"
            >
              {t("form.save_draft")}
            </ButtonAnimated>
            <ButtonAnimated
              loading={statusBtn.loadingSubmit}
              disabled={statusBtn.loadingDraft || isFeePaymentPending}
              type="submit"
              className="w-full md:min-w-[11rem] md:w-auto"
            >
              {submitLabel}
            </ButtonAnimated>
          </div>
        </div>
      </form>
      <ProgressBar progress={progress} />
    </>
  )
}
