"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ApiError,
  type ApplicationCreate,
  type ApplicationPublic,
  ApplicationsService,
  type ApplicationUpdate,
  HumansService,
} from "@/client"
import { splitForCreate, splitForUpdate } from "@/lib/form-data-splitter"
import { queryKeys } from "@/lib/query-keys"
import type { ApplicationFormSchema } from "@/types/form-schema"
import {
  type CheckoutApplicationValues,
  type CheckoutState,
  type DefaultCheckoutFormData,
  filterCheckoutApplicationValues,
  toDefaultCheckoutFormData,
} from "../types"
import useCookies from "./useCookies"

interface UseCheckoutStateProps {
  popupId: string
  saleType: "application" | "direct"
  groupId?: string | null
  inviteId?: string | null
  referralId?: string | null
  salesFlowId?: string | null
  schema?: ApplicationFormSchema
}

interface BuildCheckoutApplicationMutationPayloadArgs {
  popupId: string
  salesFlowId?: string | null
  values: CheckoutApplicationValues
  schema: ApplicationFormSchema
  existingApplication: ApplicationPublic | null
}

type CheckoutApplicationMutationPayload =
  | { kind: "create"; payload: ApplicationCreate }
  | { kind: "update"; payload: ApplicationUpdate }

export interface CheckoutSubmitError {
  /** The API said this human already has an application for this popup. */
  isDuplicate: boolean
  /** Human-readable detail the API sent, when it sent one. */
  detailText: string | null
}

/**
 * Read what the API actually reported about a failed checkout submit.
 *
 * Validation failures arrive as `{ detail: { message, errors[] } }`. A
 * string-only reader drops those, so a rejected field used to surface as the
 * generic "you already have an application" message and sent people to
 * support over a form error.
 */
export function readCheckoutSubmitError(error: unknown): CheckoutSubmitError {
  if (!(error instanceof ApiError)) {
    return { isDuplicate: false, detailText: null }
  }

  const body =
    typeof error.body === "object" && error.body !== null
      ? (error.body as Record<string, unknown>)
      : null
  const detail = body?.detail

  if (typeof detail === "string") {
    return {
      isDuplicate:
        error.status === 409 || detail.includes("already have an application"),
      detailText: detail,
    }
  }

  if (typeof detail === "object" && detail !== null) {
    const { message, errors } = detail as {
      message?: unknown
      errors?: unknown
    }
    const parts = [
      typeof message === "string" ? message : null,
      Array.isArray(errors)
        ? errors.filter((e): e is string => typeof e === "string").join(", ")
        : null,
    ].filter((part): part is string => !!part)

    return {
      isDuplicate: error.status === 409,
      detailText: parts.length > 0 ? parts.join(": ") : null,
    }
  }

  return { isDuplicate: error.status === 409, detailText: null }
}

export function buildCheckoutApplicationMutationPayload({
  popupId,
  salesFlowId,
  values,
  schema,
  existingApplication,
}: BuildCheckoutApplicationMutationPayloadArgs): CheckoutApplicationMutationPayload {
  const checkoutValues = filterCheckoutApplicationValues(schema, values)

  if (existingApplication) {
    return {
      kind: "update",
      payload: splitForUpdate({
        values: checkoutValues,
        status: "in review",
        schema,
      }),
    }
  }

  return {
    kind: "create",
    payload: {
      ...splitForCreate({
        values: checkoutValues,
        popupId,
        status: "in review",
        schema,
      }),
      ...(salesFlowId ? { sales_flow_id: salesFlowId } : {}),
    },
  }
}

export function findCheckoutApplication(
  applications: ApplicationPublic[] | undefined,
  popupId: string,
  salesFlowId?: string | null,
): ApplicationPublic | undefined {
  const popupApplications = (applications ?? []).filter(
    (application) => application.popup_id === popupId,
  )
  if (salesFlowId) {
    return popupApplications.find(
      (application) => application.sales_flow_id === salesFlowId,
    )
  }
  return popupApplications.length === 1 ? popupApplications[0] : undefined
}

export function upsertCheckoutApplication(
  applications: ApplicationPublic[] | undefined,
  application: ApplicationPublic,
): ApplicationPublic[] {
  return [
    application,
    ...(applications ?? []).filter(
      (candidate) => candidate.id !== application.id,
    ),
  ]
}

const useCheckoutState = ({
  popupId,
  saleType,
  groupId,
  inviteId,
  referralId,
  salesFlowId,
  schema,
}: UseCheckoutStateProps) => {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [checkoutState, setCheckoutState] = useState<CheckoutState>("form")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const { setCookie } = useCookies()

  const submitMutation = useMutation({
    mutationFn: async ({
      formData,
    }: {
      formData: DefaultCheckoutFormData | CheckoutApplicationValues
    }) => {
      if (!popupId) throw new Error("No popup selected")

      setCookie(
        JSON.stringify({
          ...formData,
          local_resident: formData.local_resident === "yes",
          popup_id: popupId,
        }),
      )

      if (saleType === "direct") {
        const directFormData: DefaultCheckoutFormData =
          toDefaultCheckoutFormData(formData)
        await HumansService.updateCurrentHuman({
          requestBody: {
            first_name: directFormData.first_name,
            last_name: directFormData.last_name,
            telegram: directFormData.telegram,
            gender: directFormData.gender || undefined,
          },
        })

        return { matchingApp: null }
      }

      if (!schema) {
        throw new Error("Application checkout schema is required")
      }

      const existingApps = queryClient.getQueryData<ApplicationPublic[]>(
        queryKeys.applications.mine(),
      )
      const existingApp = findCheckoutApplication(
        existingApps,
        popupId,
        salesFlowId,
      )

      const mutationPayload = buildCheckoutApplicationMutationPayload({
        popupId,
        salesFlowId,
        values: filterCheckoutApplicationValues(
          schema,
          formData as CheckoutApplicationValues,
        ),
        schema,
        existingApplication: existingApp ?? null,
      })

      let application: ApplicationPublic
      if (mutationPayload.kind === "update") {
        if (!existingApp?.sales_flow_id) {
          throw new Error("Application sales flow is required for updates")
        }
        application = await ApplicationsService.updateMyApplication({
          popupId,
          salesFlowId: existingApp.sales_flow_id,
          requestBody: {
            ...mutationPayload.payload,
            group_id: groupId ?? undefined,
          },
        })
      } else {
        application = await ApplicationsService.createMyApplication({
          requestBody: {
            ...mutationPayload.payload,
            group_id: groupId ?? undefined,
            invite_id: inviteId ?? undefined,
            referral_id: referralId ?? undefined,
          },
        })
      }

      return { matchingApp: application }
    },
    onMutate: () => {
      setCheckoutState("processing")
      setErrorMessage(null)
    },
    onSuccess: ({ matchingApp }) => {
      if (matchingApp) {
        queryClient.setQueryData<ApplicationPublic[]>(
          queryKeys.applications.mine(),
          (current) => upsertCheckoutApplication(current, matchingApp),
        )
        queryClient.invalidateQueries({
          queryKey: [...queryKeys.applications.mine(), "checkout", popupId],
          refetchType: "none",
        })
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.profile.current,
        refetchType: "active",
      })
      // The application create endpoint also creates the main attendee. Refetch
      // the human's attendees so the passes step sees it (otherwise attendee_id
      // resolves to "" and the payment POST fails with a UUID parse error).
      queryClient.invalidateQueries({
        queryKey: queryKeys.attendees.byHumanPopup(popupId),
      })
      setCheckoutState("passes")
      setErrorMessage(null)
    },
    onError: async (error: unknown) => {
      const { isDuplicate, detailText } = readCheckoutSubmitError(error)

      // A 400/409 may mean this human already applied. Probe for that
      // application: when it exists the flow just resumes at the passes step.
      if (
        saleType === "application" &&
        error instanceof ApiError &&
        (error.status === 400 || error.status === 409)
      ) {
        try {
          const token = window?.localStorage?.getItem("token")
          if (token) {
            const result = await ApplicationsService.listMyApplications()
            const existingApp = findCheckoutApplication(
              result.results,
              popupId,
              salesFlowId,
            )

            if (existingApp) {
              queryClient.setQueryData<ApplicationPublic[]>(
                queryKeys.applications.mine(),
                (current) => upsertCheckoutApplication(current, existingApp),
              )
              setCheckoutState("passes")
              setErrorMessage(null)
              return
            }
          }
        } catch (subError) {
          console.error("Error retrieving existing application:", subError)
        }
      }

      // No existing application, so the failure was something else — a
      // rejected payload, an exhausted link. Report what the API said rather
      // than claiming a duplicate.
      setErrorMessage(
        isDuplicate
          ? t("checkout.duplicate_application")
          : (detailText ?? t("checkout.submit_error")),
      )

      setCheckoutState("form")
    },
  })

  // Existing applicant arriving through a group link. Persist the group on the
  // current application so the backend can apply that group's approval policy
  // and discount. Manual-approval groups are gated before this mutation runs.
  const joinGroupMutation = useMutation({
    mutationFn: async () => {
      if (!popupId) throw new Error("No popup selected")
      if (!groupId) throw new Error("No group selected")
      if (!salesFlowId) throw new Error("No sales flow selected")
      return ApplicationsService.updateMyApplication({
        popupId,
        salesFlowId,
        requestBody: { group_id: groupId },
      })
    },
    onMutate: () => {
      setCheckoutState("processing")
      setErrorMessage(null)
    },
    onSuccess: (application) => {
      queryClient.setQueryData<ApplicationPublic[]>(
        queryKeys.applications.mine(),
        (current) => upsertCheckoutApplication(current, application),
      )
      queryClient.invalidateQueries({
        queryKey: queryKeys.attendees.byHumanPopup(popupId),
      })
      setCheckoutState("passes")
      setErrorMessage(null)
    },
    onError: (error: unknown) => {
      const { detailText } = readCheckoutSubmitError(error)
      setErrorMessage(detailText ?? t("checkout.submit_error"))
      setCheckoutState("form")
    },
  })

  const handleSubmit = async (
    formData: DefaultCheckoutFormData | CheckoutApplicationValues,
  ): Promise<void> => {
    await submitMutation.mutateAsync({ formData })
  }

  return {
    checkoutState,
    isSubmitting: submitMutation.isPending,
    errorMessage,
    handleSubmit,
    setCheckoutState,
    joinGroupAsApplicant: joinGroupMutation.mutate,
    isJoiningGroup: joinGroupMutation.isPending,
  }
}

export default useCheckoutState
