"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { ApplicationPublic, PopupPublic } from "@/client"
import { ApplicationsService } from "@/client"
import { useApplicationFee } from "@/hooks/useApplicationFee"
import { splitForCreate, splitForUpdate } from "@/lib/form-data-splitter"
import { queryKeys } from "@/lib/query-keys"
import { useApplication } from "@/providers/applicationProvider"
import type { ApplicationFormSchema } from "@/types/form-schema"
import type { CompanionWithId } from "../components/companions-section"

/** Virtual/synthetic form values that have no entry in schema.base_fields
 * but do surface on errors. Maps them to an i18n key. */
const VIRTUAL_FIELD_I18N_KEYS: Record<string, string> = {
  gender_specify: "form.gender_specify",
}

/** Resolve a form field name to its user-facing label. Falls back to the
 * raw name so we never show `undefined` if the schema drifts. */
function resolveFieldLabel(
  name: string,
  schema: ApplicationFormSchema,
  t: (key: string) => string,
): string {
  if (name.startsWith("custom_")) {
    const customName = name.slice("custom_".length)
    return schema.custom_fields[customName]?.label ?? name
  }
  const baseLabel = schema.base_fields[name]?.label
  if (baseLabel) return baseLabel
  const i18nKey = VIRTUAL_FIELD_I18N_KEYS[name]
  if (i18nKey) return t(i18nKey)
  return name
}

interface UseSubmitApplicationArgs {
  popup: PopupPublic
  schema: ApplicationFormSchema
  values: Record<string, unknown>
  companions: CompanionWithId[]
  application: ApplicationPublic | null | undefined
  validate: (isDraft: boolean) => {
    isValid: boolean
    errors: Record<string, string>
  }
}

/** Owns the create-or-update mutation, the "submit" and "save draft" flows,
 * and the Stripe-style fee payment redirect. The UI binds directly to the
 * returned handlers and pending flags. */
export function useSubmitApplication({
  popup,
  schema,
  values,
  companions,
  application,
  validate,
}: UseSubmitApplicationArgs) {
  const { t } = useTranslation()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { updateApplication } = useApplication()
  const { createOrResume, isPending: isFeePaymentPending } = useApplicationFee()

  const [statusBtn, setStatusBtn] = useState({
    loadingDraft: false,
    loadingSubmit: false,
  })

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
      const fields = Object.keys(validationErrors)
        .map((name) => resolveFieldLabel(name, schema, t))
        .join(", ")
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

  return {
    handleSubmit,
    handleDraft,
    isDraftPending: statusBtn.loadingDraft,
    isSubmitPending: statusBtn.loadingSubmit,
    isFeePaymentPending,
  }
}
