"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useApplicationData } from "../../hooks/useApplicationData"
import { useEmailVerification } from "../../hooks/useEmailVerification"
import { useUserForm } from "../../hooks/useUserForm"
import type { FormDataProps } from "../../types"
import EmailVerification from "./EmailVerification"
import PersonalInfoForm from "./PersonalInfoForm"

interface UserInfoFormProps {
  popupId: string
  onSubmit: (data: FormDataProps) => Promise<void>
  isSubmitting: boolean
}

const UserInfoForm = ({
  popupId,
  onSubmit,
  isSubmitting,
}: UserInfoFormProps) => {
  const [_isAutoFilled, setIsAutoFilled] = useState(false)

  const {
    applicationData,
    isLoading: isLoadingApplication,
    refreshApplicationData,
  } = useApplicationData({
    groupPopupCityId: popupId,
  })

  const {
    formData,
    errors,
    setErrors,
    handleInputChange,
    validateForm,
    setEmailVerified,
    resetForm,
  } = useUserForm({
    applicationData,
  })

  // Set autoFilled flag when applicationData has more than just email
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
    email: formData.email,
    onVerificationSuccess: (_token) => {
      setEmailVerified(formData.email)
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

    if (
      !formData.email_verified &&
      formData.email &&
      !/^\S+@\S+\.\S+$/.test(formData.email)
    ) {
      setErrors((prev) => ({
        ...prev,
        email: "Invalid email",
      }))
      return
    }

    if (!formData.email_verified) {
      if (!showVerificationInput) {
        await handleSendVerificationCode()
      } else {
        await handleVerifyCode()
      }
      return
    }

    if (validateForm()) {
      try {
        await onSubmit(formData)
      } catch (error: any) {
        console.error("Error submitting form:", error)
        if (error.response?.data?.message) {
          setErrors((prev) => ({
            ...prev,
            general: error.response.data.message,
          }))
        } else {
          setErrors((prev) => ({
            ...prev,
            general:
              "An error occurred while submitting the form. Please try again.",
          }))
        }
      }
    }
  }

  if (errors.general) {
    return (
      <Card className="max-w-lg mx-auto backdrop-blur bg-white/90">
        <CardHeader>
          <CardTitle className="text-2xl font-bold mb-2">Checkout</CardTitle>
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
            Loading your information
          </CardTitle>
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
        <CardTitle className="text-2xl font-bold">Express Checkout</CardTitle>
      </CardHeader>
      <form noValidate onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          {!formData.email_verified && (
            <EmailVerification
              email={formData.email}
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

          {formData.email_verified && (
            <PersonalInfoForm
              formData={formData}
              handleInputChange={handleInputChange}
              handleChangeEmail={handleEmailChange}
              errors={errors}
            />
          )}
        </CardContent>

        <CardFooter>
          <Button
            type="submit"
            className="w-full"
            disabled={
              isSubmitting ||
              (showVerificationInput &&
                verificationCode.length !== 6 &&
                !formData.email_verified) ||
              isSendingCode ||
              isVerifyingCode
            }
          >
            {isSubmitting
              ? "Processing..."
              : formData.email_verified
                ? "Continue"
                : showVerificationInput
                  ? "Verify Code"
                  : "Send Code"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

export default UserInfoForm
