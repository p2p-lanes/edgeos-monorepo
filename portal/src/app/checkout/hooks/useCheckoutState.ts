"use client"

import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { ApiError, type ApplicationPublic, ApplicationsService } from "@/client"
import { queryKeys } from "@/lib/query-keys"
import type { CheckoutState, FormDataProps } from "../types"
import useCookies from "./useCookies"

const useCheckoutState = ({ popupId }: { popupId: string }) => {
  const queryClient = useQueryClient()
  const [checkoutState, setCheckoutState] = useState<CheckoutState>("form")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const { setCookie } = useCookies()

  const submitMutation = useMutation({
    mutationFn: async ({ formData }: { formData: FormDataProps }) => {
      if (!popupId) throw new Error("No popup selected")

      setCookie(
        JSON.stringify({
          ...formData,
          local_resident: formData.local_resident === "yes",
          popup_id: popupId,
        }),
      )

      // Check if an application already exists (e.g. user navigated back)
      const existingApps = queryClient.getQueryData<ApplicationPublic[]>(
        queryKeys.applications.mine(),
      )
      const existingApp = existingApps?.find((app) => app.popup_id === popupId)

      let application: ApplicationPublic
      if (existingApp) {
        application = await ApplicationsService.updateMyApplication({
          popupId,
          requestBody: {
            first_name: formData.first_name,
            last_name: formData.last_name,
            telegram: formData.telegram,
            gender: formData.gender || undefined,
          },
        })
      } else {
        application = await ApplicationsService.createMyApplication({
          requestBody: {
            popup_id: popupId,
            first_name: formData.first_name,
            last_name: formData.last_name,
            email: formData.email,
            telegram: formData.telegram,
            gender: formData.gender || undefined,
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
      setCheckoutState("passes")
      setErrorMessage(null)
    },
    onError: async (error: any) => {
      if (
        error instanceof ApiError &&
        (error.status === 400 ||
          error.status === 409 ||
          (error.body as any)?.detail?.includes("already have an application"))
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
          "You already have a pending application for this event. Please check your email or contact support.",
        )
      } else {
        const msg =
          error instanceof ApiError
            ? ((error.body as any)?.detail ??
              "Something went wrong. Please try again.")
            : "Something went wrong. Please try again."
        setErrorMessage(msg)
      }

      setCheckoutState("form")
    },
  })

  const handleSubmit = async (formData: FormDataProps): Promise<void> => {
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
