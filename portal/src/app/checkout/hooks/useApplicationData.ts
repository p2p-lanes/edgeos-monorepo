import { useQuery, useQueryClient } from "@tanstack/react-query"
import type { ApplicationPublic, HumanPublic } from "@/client"
import { ApplicationsService, HumansService } from "@/client"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"
import type { ApplicationFormSchema } from "@/types/form-schema"
import {
  type CheckoutApplicationValues,
  getCheckoutFieldDefaultValue,
  getCheckoutMiniFormSchema,
  HUMAN_FIELD_KEYS,
} from "../types"

interface ExtendedApplicationData extends CheckoutApplicationValues {}

interface UseApplicationDataProps {
  groupPopupCityId?: string
  schema?: ApplicationFormSchema
}

function getSpecifiedGenderValue(value: unknown): string {
  if (typeof value !== "string") return ""
  if (value.startsWith("SYO - ")) return value.slice("SYO - ".length)
  return value
}

interface HydrateCheckoutApplicationValuesArgs {
  schema: ApplicationFormSchema
  human?: HumanPublic | null
  application?: ApplicationPublic | null
  popupId?: string
}

export function hydrateCheckoutApplicationValues({
  schema,
  human,
  application,
  popupId,
}: HydrateCheckoutApplicationValuesArgs): ExtendedApplicationData {
  const values: ExtendedApplicationData = {}
  const checkoutSchema = getCheckoutMiniFormSchema(schema)

  for (const [name, field] of Object.entries(checkoutSchema.base_fields)) {
    values[name] = getCheckoutFieldDefaultValue(field)
  }
  for (const [name, field] of Object.entries(checkoutSchema.custom_fields)) {
    values[`custom_${name}`] = getCheckoutFieldDefaultValue(field)
  }
  values.gender_specify = ""
  values.email_verified = Boolean(human?.email)

  const isCurrentPopupApplication = application?.popup_id === popupId

  for (const [name, field] of Object.entries(checkoutSchema.base_fields)) {
    const readsHuman = field.target === "human" || HUMAN_FIELD_KEYS.has(name)

    if (isCurrentPopupApplication && application) {
      if (readsHuman && application.human) {
        const value = (application.human as Record<string, unknown>)[name]
        if (value !== undefined && value !== null) values[name] = value
      } else {
        const value = (application as Record<string, unknown>)[name]
        if (value !== undefined && value !== null) values[name] = value
      }
      if (
        readsHuman &&
        human &&
        (values[name] === "" ||
          values[name] === undefined ||
          values[name] === null)
      ) {
        const fallbackValue = (human as Record<string, unknown>)[name]
        if (fallbackValue !== undefined && fallbackValue !== null) {
          values[name] = fallbackValue
        }
      }
      continue
    }

    if (application?.human && readsHuman) {
      const importedValue = (application.human as Record<string, unknown>)[name]
      if (importedValue !== undefined && importedValue !== null) {
        values[name] = importedValue
        continue
      }
    }

    if (readsHuman && human) {
      const value = (human as Record<string, unknown>)[name]
      if (value !== undefined && value !== null) values[name] = value
    }
  }

  if (isCurrentPopupApplication && application?.custom_fields) {
    for (const [name] of Object.entries(checkoutSchema.custom_fields)) {
      const customValue = application.custom_fields[name]
      if (customValue !== undefined && customValue !== null) {
        values[`custom_${name}`] = customValue
      }
    }
  }

  const normalizedGender = values.gender
  if (typeof normalizedGender === "string") {
    const genderOptions = checkoutSchema.base_fields.gender?.options ?? []
    if (normalizedGender && !genderOptions.includes(normalizedGender)) {
      values.gender_specify = getSpecifiedGenderValue(normalizedGender)
    }
  }

  return values
}

export const useApplicationData = ({
  groupPopupCityId,
  schema,
}: UseApplicationDataProps) => {
  const queryClient = useQueryClient()
  const isAuthenticated = useIsAuthenticated()

  const {
    data: applicationData = null,
    isLoading,
    error: queryError,
  } = useQuery({
    queryKey: [...queryKeys.applications.mine(), "checkout", groupPopupCityId],
    queryFn: async (): Promise<ExtendedApplicationData | null> => {
      if (!schema) return null
      const token = window?.localStorage?.getItem("token")
      if (!token) return null

      const human = await HumansService.getCurrentHumanInfo()
      if (!human?.email) return null

      let matchingApplication: ApplicationPublic | null = null
      if (groupPopupCityId) {
        try {
          const result = await ApplicationsService.listMyApplications()
          matchingApplication =
            result.results.find((app) => app.popup_id === groupPopupCityId) ??
            null
        } catch {
          matchingApplication = null
        }
      }

      return hydrateCheckoutApplicationValues({
        schema,
        human,
        application: matchingApplication,
        popupId: groupPopupCityId,
      })
    },
    enabled: isAuthenticated && Boolean(schema),
  })

  const refreshApplicationData = () => {
    queryClient.invalidateQueries({
      queryKey: [
        ...queryKeys.applications.mine(),
        "checkout",
        groupPopupCityId,
      ],
    })
  }

  return {
    isLoading,
    error: queryError?.message ?? null,
    applicationData,
    refreshApplicationData,
  }
}
