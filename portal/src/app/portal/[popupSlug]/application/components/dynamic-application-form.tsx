"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "framer-motion"
import { useRouter } from "next/navigation"
import { memo, useCallback, useEffect, useMemo, useState } from "react"
import { toast } from "sonner"
import type { ApplicationPublic, PopupPublic } from "@/client"
import { ApplicationsService } from "@/client"
import { ButtonAnimated } from "@/components/ui/button"
import InputForm, { AddonInputForm } from "@/components/ui/Form/Input"
import SelectForm from "@/components/ui/Form/Select"
import { splitForCreate, splitForUpdate } from "@/lib/form-data-splitter"
import { queryKeys } from "@/lib/query-keys"
import { useApplication } from "@/providers/applicationProvider"
import type {
  ApplicationFormSchema,
  FormFieldSchema,
} from "@/types/form-schema"
import { useApplicationForm } from "../hooks/use-application-form"
import { CompanionsSection, type CompanionWithId } from "./companions-section"
import { DynamicField } from "./fields/dynamic-field"
import { ProgressBar } from "./progress-bar"
import SectionWrapper from "./SectionWrapper"
import { SectionSeparator } from "./section-separator"

const animationProps = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: "auto" },
  exit: { opacity: 0, height: 0 },
  transition: { duration: 0.3, ease: "easeInOut" },
}

const FULL_WIDTH_TYPES = new Set(["textarea", "multiselect", "url", "select_cards"])

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
                label="Specify your gender"
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
  const router = useRouter()
  const queryClient = useQueryClient()
  const { getRelevantApplication, updateApplication } = useApplication()
  const application = getRelevantApplication()

  const {
    values,
    errors,
    handleChange,
    validate,
    populateFromApplication,
    progress,
  } = useApplicationForm(schema)

  const [companions, setCompanions] = useState<CompanionWithId[]>([])
  const [statusBtn, setStatusBtn] = useState({
    loadingDraft: false,
    loadingSubmit: false,
  })

  // Populate form if editing existing application
  useEffect(() => {
    if (existingApplication) {
      populateFromApplication(existingApplication)

      // Populate companions from attendees
      if (existingApplication.attendees) {
        const existingCompanions: CompanionWithId[] =
          existingApplication.attendees
            .filter((a) => a.category === "spouse" || a.category === "kid")
            .map((a) => ({
              _id: a.id,
              name: a.name,
              category: a.category,
              email: a.email ?? undefined,
              gender: a.gender ?? undefined,
            }))
        setCompanions(existingCompanions)
      }
    }
  }, [existingApplication, populateFromApplication])

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
    setStatusBtn({ loadingDraft: false, loadingSubmit: true })

    const { isValid, errors: validationErrors } = validate(false)
    if (!isValid) {
      const fields = Object.keys(validationErrors).join(", ")
      toast.error("Error", {
        description: `Please fill in the following required fields: ${fields}`,
      })
      setStatusBtn({ loadingDraft: false, loadingSubmit: false })
      return
    }

    try {
      await submitMutation.mutateAsync("in review")
      toast.success("Application Submitted", {
        description: "Your application has been successfully submitted.",
      })
      router.push(`/portal/${popup.slug}`)
    } catch {
      toast.error("Error Submitting Application", {
        description:
          "There was an error submitting your application. Please try again.",
      })
    }
    setStatusBtn({ loadingDraft: false, loadingSubmit: false })
  }

  const handleDraft = async () => {
    setStatusBtn({ loadingDraft: true, loadingSubmit: false })
    try {
      await submitMutation.mutateAsync("draft")
      toast.success("Draft Saved", {
        description: "Your draft has been successfully saved.",
      })
    } catch {
      toast.error("Error Saving Draft", {
        description: "There was an error saving your draft. Please try again.",
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
    for (const fields of Object.values(bySectionIdCustom)) sortByPosition(fields)

    const result: SectionBlock[] = []
    const sortedSections = [...(schema.sections ?? [])].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    )

    // 1. Unsectioned base first
    if (bySectionIdBase._unsectioned?.length) {
      result.push({
        id: "_unsectioned_base",
        title: "Personal Information",
        subtitle:
          "Your basic information helps us identify and contact you.",
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
        title: "Additional Information",
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
        title: "Other",
        baseFields,
        customFields,
      })
    }

    return result
  }, [schema])

  const hasChildrenSection = useMemo(
    () =>
      mergedSections.some((block) =>
        block.title.toLowerCase().includes("children"),
      ),
    [mergedSections],
  )

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-8 px-8 md:px-12">
        {/* Sections in schema order (base + custom fields per section) */}
        {mergedSections.map(({ id, title, subtitle, baseFields, customFields }) => {
          const isChildrenSection = title.toLowerCase().includes("children")
          if (isChildrenSection) {
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
                      genderSpecifyValue={(values.gender_specify as string) ?? ""}
                      genderSpecifyError={errors.gender_specify}
                    />
                  ))}
                  {customFields.map(([name, field]) => (
                    <div
                      key={name}
                      className={
                        FULL_WIDTH_TYPES.has(field.type) ? "md:col-span-2" : ""
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
        })}

        {/* Companions section (only when no "Children" section from API) */}
        {/* {!hasChildrenSection && (
          <CompanionsSection
            allowsSpouse={popup.allows_spouse ?? false}
            allowsChildren={popup.allows_children ?? false}
            companions={companions}
            onCompanionsChange={setCompanions}
          />
        )} */}

        {/* Submit buttons */}
        <div className="flex flex-col w-full gap-6 md:flex-row justify-between items-center pt-6">
          <ButtonAnimated
            loading={statusBtn.loadingDraft}
            disabled={statusBtn.loadingSubmit}
            variant="outline"
            type="button"
            onClick={handleDraft}
            className="w-full md:w-auto"
          >
            Save as draft
          </ButtonAnimated>
          <ButtonAnimated
            loading={statusBtn.loadingSubmit}
            disabled={statusBtn.loadingDraft}
            type="submit"
            className="w-full md:w-auto"
          >
            Submit
          </ButtonAnimated>
        </div>
      </form>
      <ProgressBar progress={progress} />
    </>
  )
}
