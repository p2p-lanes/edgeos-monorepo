"use client"

import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { ApplicationFormSchema } from "@/types/form-schema"
import { useApplicationData } from "../../hooks/useApplicationData"
import { useEmailVerification } from "../../hooks/useEmailVerification"
import { useUserForm } from "../../hooks/useUserForm"
import type {
  CheckoutApplicationValues,
  DefaultCheckoutFormData,
} from "../../types"
import EmailVerification from "./EmailVerification"
import PersonalInfoForm from "./PersonalInfoForm"

interface UserInfoFormProps {
  popupId: string
  popupName: string
  otpEnabled: boolean
  schema?: ApplicationFormSchema
  onSubmit: (
    data: DefaultCheckoutFormData | CheckoutApplicationValues,
  ) => Promise<void>
  isSubmitting: boolean
}

const UserInfoForm = ({
  popupId,
  popupName,
  otpEnabled,
  schema,
  onSubmit,
  isSubmitting,
}: UserInfoFormProps) => {
  const { t } = useTranslation()
  const [_isAutoFilled, setIsAutoFilled] = useState(false)

  const {
    applicationData,
    isLoading: isLoadingApplication,
    refreshApplicationData,
  } = useApplicationData({
    groupPopupCityId: popupId,
    schema,
  })

  const {
    formData,
    emailVerified,
    errors,
    setErrors,
    handleInputChange,
    validateForm,
    setEmailVerified,
    resetForm,
  } = useUserForm({
    applicationData,
    schema,
  })

  useEffect(() => {
    if (
      applicationData &&
      (applicationData.first_name ||
        applicationData.last_name ||
        applicationData.telegram)
    ) {
      setIsAutoFilled(true)
    }
  }, [applicationData])

  const {
    otpEnabled: isOtpEnabled,
    showVerificationInput,
    verificationCode,
    setVerificationCode,
    isSendingCode,
    isVerifyingCode,
    verificationError,
    countdown,
    handleSendVerificationCode,
    handleVerifyCode,
    handleResendCode,
    handleChangeEmail,
  } = useEmailVerification({
    popupId,
    otpEnabled,
    email: String(formData.email ?? ""),
    onVerificationSuccess: (_token) => {
      setEmailVerified(String(formData.email ?? ""))
      refreshApplicationData()
    },
  })

  const handleEmailChange = () => {
    handleChangeEmail()
    resetForm()
    setIsAutoFilled(false)
    window?.localStorage?.removeItem("token")
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!emailVerified) {
      if (!showVerificationInput || !isOtpEnabled) {
        await handleSendVerificationCode()
      } else {
        await handleVerifyCode()
      }
      return
    }

    if (validateForm()) {
      try {
        await onSubmit(formData)
      } catch (error: unknown) {
        console.error("Error submitting form:", error)
        const errorMessage =
          typeof error === "object" &&
          error !== null &&
          "response" in error &&
          typeof error.response === "object" &&
          error.response !== null &&
          "data" in error.response &&
          typeof error.response.data === "object" &&
          error.response.data !== null &&
          "message" in error.response.data &&
          typeof error.response.data.message === "string"
            ? error.response.data.message
            : null

        if (errorMessage) {
          setErrors((prev) => ({
            ...prev,
            general: errorMessage,
          }))
        } else {
          setErrors((prev) => ({
            ...prev,
            general: t("checkout.submit_error"),
          }))
        }
      }
    }
  }

  if (errors.general) {
    return (
      <Card className="max-w-lg mx-auto backdrop-blur bg-white/90">
        <CardHeader>
          <CardTitle className="text-2xl font-bold mb-2">
            {t("checkout.title")}
          </CardTitle>
          <CardDescription>{popupName}</CardDescription>
          <div className="mt-6 p-3 bg-red-100 border border-red-300 text-red-800 rounded-md">
            {errors.general}
          </div>
        </CardHeader>
      </Card>
    )
  }

  if (isLoadingApplication) {
    return (
      <Card className="max-w-lg mx-auto backdrop-blur bg-white/90">
        <CardHeader>
          <CardTitle className="text-2xl font-bold mb-2">
            {t("checkout.loading_info")}
          </CardTitle>
          <CardDescription>{popupName}</CardDescription>
        </CardHeader>
        <CardContent className="flex justify-center py-6">
          <div className="animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 border-blue-500" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="max-w-lg mx-auto backdrop-blur bg-white/90">
      <CardHeader>
        <CardTitle className="text-2xl font-bold">
          {t("checkout.express_title")}
        </CardTitle>
        <CardDescription>{popupName}</CardDescription>
      </CardHeader>
      <form noValidate onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {!emailVerified && (
            <EmailVerification
              otpEnabled={isOtpEnabled}
              email={String(formData.email ?? "")}
              showVerificationInput={showVerificationInput}
              verificationCode={verificationCode}
              setVerificationCode={setVerificationCode}
              verificationError={verificationError}
              countdown={countdown}
              handleEmailChange={(value) => handleInputChange("email", value)}
              handleSendCode={handleSendVerificationCode}
              handleResendCode={handleResendCode}
              handleChangeEmail={handleChangeEmail}
              isDisabled={isSendingCode || isVerifyingCode}
              emailError={errors.email}
            />
          )}

          {emailVerified && (
            <PersonalInfoForm
              formData={formData}
              handleInputChange={handleInputChange}
              handleChangeEmail={handleEmailChange}
              errors={errors}
              schema={schema}
            />
          )}
        </CardContent>

        <CardFooter>
          <Button
            type="submit"
            className="w-full"
            disabled={
              isSubmitting ||
              (isOtpEnabled &&
                showVerificationInput &&
                verificationCode.length !== 6 &&
                !emailVerified) ||
              isSendingCode ||
              isVerifyingCode
            }
          >
            {isSubmitting
              ? t("common.processing")
              : emailVerified
                ? t("common.continue")
                : isOtpEnabled && showVerificationInput
                  ? t("checkout.verify_code")
                  : isOtpEnabled
                    ? t("checkout.send_code")
                    : t("common.continue")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

export default UserInfoForm
