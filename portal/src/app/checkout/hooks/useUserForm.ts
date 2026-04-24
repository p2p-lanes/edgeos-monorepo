import { useEffect, useState } from "react"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { buildFormZodSchema } from "@/lib/form-schema-builder"
import type { ApplicationFormSchema } from "@/types/form-schema"
import {
  type CheckoutApplicationValues,
  type DefaultCheckoutFormData,
  filterCheckoutApplicationValues,
  getCheckoutFieldDefaultValue,
  getCheckoutMiniFormSchema,
  toDefaultCheckoutFormData,
} from "../types"

interface UseUserFormProps {
  initialData?: Partial<DefaultCheckoutFormData>
  applicationData?: CheckoutApplicationValues | null
  schema?: ApplicationFormSchema
}

const defaultCheckoutFormData: DefaultCheckoutFormData = {
  first_name: "",
  last_name: "",
  email: "",
  telegram: "",
  gender: "",
  email_verified: false,
  local_resident: "",
}

export const useUserForm = ({
  initialData = {},
  applicationData,
  schema,
}: UseUserFormProps = {}) => {
  const isAuthenticated = useIsAuthenticated()
  const checkoutSchema = schema ? getCheckoutMiniFormSchema(schema) : undefined

  const getCheckoutScopedValues = (
    values?: CheckoutApplicationValues | null,
  ): CheckoutApplicationValues => {
    if (!schema || !values) return values ?? {}
    return filterCheckoutApplicationValues(schema, values)
  }

  const getSchemaDefaultValues = (): CheckoutApplicationValues => {
    if (!checkoutSchema) return {}

    const values: CheckoutApplicationValues = {
      gender_specify: "",
    }

    for (const [name, field] of Object.entries(checkoutSchema.base_fields)) {
      values[name] = getCheckoutFieldDefaultValue(field)
    }

    return values
  }

  const [formData, setFormData] = useState<CheckoutApplicationValues>(() =>
    checkoutSchema
      ? {
          ...getSchemaDefaultValues(),
          ...getCheckoutScopedValues(applicationData),
        }
      : ({
          ...defaultCheckoutFormData,
          ...initialData,
          ...(applicationData ?? {}),
          email_verified:
            (applicationData?.email_verified as boolean | undefined) ??
            isAuthenticated ??
            false,
        } as CheckoutApplicationValues),
  )

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [emailVerified, setEmailVerifiedState] = useState(
    (applicationData?.email_verified as boolean | undefined) ??
      isAuthenticated ??
      false,
  )

  useEffect(() => {
    if (applicationData) {
      const scopedValues = !schema
        ? applicationData
        : filterCheckoutApplicationValues(schema, applicationData)

      setFormData((prev) => ({
        ...prev,
        ...scopedValues,
      }))
      setEmailVerifiedState(
        (applicationData.email_verified as boolean | undefined) ??
          isAuthenticated ??
          false,
      )
    }
  }, [applicationData, isAuthenticated, schema])

  const handleInputChange = (field: string, value: unknown) => {
    setFormData((prev) => {
      const nextValues: CheckoutApplicationValues = {
        ...prev,
        [field]: value,
      }

      if (field === "email") {
        setEmailVerifiedState(false)
      }

      if (field === "gender") {
        if (value !== "Specify") {
          nextValues.gender_specify = ""
        }
      }

      if (field === "gender_specify") {
        nextValues.gender = value ? `SYO - ${value}` : "Specify"
      }

      return nextValues
    })

    if (errors[field]) {
      setErrors((prev) => {
        const newErrors = { ...prev }
        delete newErrors[field]
        return newErrors
      })
    }
  }

  const validateForm = () => {
    const newErrors: Record<string, string> = {}

    if (checkoutSchema) {
      const result = buildFormZodSchema(checkoutSchema, false).safeParse(
        formData,
      )
      if (!result.success) {
        for (const issue of result.error.issues) {
          const path = issue.path.join(".")
          if (!newErrors[path]) {
            newErrors[path] = issue.message
          }
        }
      }

      const genderValue = formData.gender
      const genderSpecify = formData.gender_specify
      if (
        (genderValue === "Specify" ||
          (typeof genderValue === "string" &&
            genderValue.startsWith("SYO - "))) &&
        !String(genderSpecify ?? "").trim()
      ) {
        newErrors.gender_specify = "Please specify your gender"
      }

      if (!emailVerified) {
        newErrors.email =
          "Email verification is required. Please verify your email before continuing."
      }
    } else {
      const defaultFormData: DefaultCheckoutFormData =
        toDefaultCheckoutFormData(formData)
      if (!defaultFormData.first_name)
        newErrors.first_name = "First name is required"
      if (!defaultFormData.last_name)
        newErrors.last_name = "Last name is required"

      if (!defaultFormData.email && !emailVerified) {
        newErrors.email = "Email is required"
      } else if (!/^\S+@\S+\.\S+$/.test(defaultFormData.email)) {
        newErrors.email = "Invalid email"
      } else if (!emailVerified) {
        newErrors.email =
          "Email verification is required. Please verify your email before continuing."
      }
      if (!defaultFormData.telegram) newErrors.telegram = "Telegram is required"
      if (!defaultFormData.gender) newErrors.gender = "Gender is required"
      if (defaultFormData.gender === "Specify") {
        newErrors.gender_specify = "Please specify your gender"
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const setEmailVerified = (email: string) => {
    setFormData((prev) => ({
      ...prev,
      email,
    }))
    setEmailVerifiedState(true)
  }

  const resetForm = () => {
    setFormData(
      checkoutSchema
        ? getSchemaDefaultValues()
        : ({ ...defaultCheckoutFormData } as CheckoutApplicationValues),
    )
    setEmailVerifiedState(false)
    setErrors({})
  }

  return {
    formData,
    emailVerified,
    errors,
    setErrors,
    handleInputChange,
    validateForm,
    setEmailVerified,
    setFormData,
    resetForm,
  }
}
