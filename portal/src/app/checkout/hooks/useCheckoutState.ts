"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
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
  schema?: ApplicationFormSchema
}

interface BuildCheckoutApplicationMutationPayloadArgs {
  popupId: string
  values: CheckoutApplicationValues
  schema: ApplicationFormSchema
  existingApplication: ApplicationPublic | null
}

type CheckoutApplicationMutationPayload =
  | { kind: "create"; payload: ApplicationCreate }
  | { kind: "update"; payload: ApplicationUpdate }

function getApiErrorDetail(error: ApiError): string | null {
  if (typeof error.body !== "object" || error.body === null) return null
  const detail = (error.body as Record<string, unknown>).detail
  return typeof detail === "string" ? detail : null
}

export function buildCheckoutApplicationMutationPayload({
  popupId,
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
    payload: splitForCreate({
      values: checkoutValues,
      popupId,
      companions: [],
      status: "in review",
      schema,
    }),
  }
}

const useCheckoutState = ({
  popupId,
  saleType,
  groupId,
  schema,
}: UseCheckoutStateProps) => {
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
      const existingApp = existingApps?.find((app) => app.popup_id === popupId)

      const mutationPayload = buildCheckoutApplicationMutationPayload({
        popupId,
        values: filterCheckoutApplicationValues(
          schema,
          formData as CheckoutApplicationValues,
        ),
        schema,
        existingApplication: existingApp ?? null,
      })

      let application: ApplicationPublic
      if (mutationPayload.kind === "update") {
        application = await ApplicationsService.updateMyApplication({
          popupId,
          requestBody: mutationPayload.payload,
        })
      } else {
        application = await ApplicationsService.createMyApplication({
          requestBody: {
            ...mutationPayload.payload,
            group_id: groupId ?? undefined,
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
        queryClient.setQueryData(queryKeys.applications.mine(), [matchingApp])
        queryClient.invalidateQueries({
          queryKey: [...queryKeys.applications.mine(), "checkout", popupId],
          refetchType: "none",
        })
      }
      queryClient.invalidateQueries({
        queryKey: queryKeys.profile.current,
        refetchType: "active",
      })
      setCheckoutState("passes")
      setErrorMessage(null)
    },
    onError: async (error: unknown) => {
      const detail = error instanceof ApiError ? getApiErrorDetail(error) : null

      if (
        saleType === "application" &&
        error instanceof ApiError &&
        (error.status === 400 ||
          error.status === 409 ||
          detail?.includes("already have an application"))
      ) {
        try {
          const token = window?.localStorage?.getItem("token")
          if (token) {
            const result = await ApplicationsService.listMyApplications()
            const existingApp = result.results.find(
              (app) => app.popup_id === popupId,
            )

            if (existingApp) {
              queryClient.setQueryData(queryKeys.applications.mine(), [
                existingApp,
              ])
              setCheckoutState("passes")
              setErrorMessage(null)
              return
            }
          }
        } catch (subError) {
          console.error("Error retrieving existing application:", subError)
        }

        setErrorMessage(
          "You already have a pending application for this pop-up. Please check your email or contact support.",
        )
      } else {
        const msg =
          detail ??
          (error instanceof ApiError
            ? "Something went wrong. Please try again."
            : "Something went wrong. Please try again.")
        setErrorMessage(msg)
      }

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
  }
}

export default useCheckoutState
