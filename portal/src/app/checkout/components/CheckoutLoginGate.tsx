"use client"

import { useState } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { useEmailVerification } from "../hooks/useEmailVerification"
import EmailVerification from "./UserInfoForm/EmailVerification"

export default function CheckoutLoginGate() {
  const { t } = useTranslation()
  const [email, setEmail] = useState("")
  const [emailError, setEmailError] = useState<string | undefined>(undefined)

  const {
    showVerificationInput,
    verificationCode,
    setVerificationCode,
    verificationError,
    countdown,
    isSendingCode,
    isVerifyingCode,
    handleSendVerificationCode,
    handleResendCode,
    handleChangeEmail,
  } = useEmailVerification({
    email,
    onVerificationSuccess: () => {},
  })

  const isBusy = isSendingCode || isVerifyingCode

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email) {
      setEmailError(t("auth.email_required"))
      return
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setEmailError(t("auth.invalid_email"))
      return
    }

    setEmailError(undefined)

    if (!showVerificationInput) {
      await handleSendVerificationCode()
    }
  }

  const handleEmailChange = (value: string) => {
    setEmail(value)
    setEmailError(undefined)
  }

  const resetEmail = () => {
    handleChangeEmail()
    setEmailError(undefined)
  }

  return (
    <Card className="max-w-lg mx-auto backdrop-blur bg-white/90">
      <CardHeader>
        <CardTitle className="text-2xl font-bold">
          {t("checkout.express_title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Sign in to continue to the application form.
        </p>
      </CardHeader>
      <form noValidate onSubmit={handleSubmit}>
        <CardContent className="space-y-4">
          <EmailVerification
            email={email}
            showVerificationInput={showVerificationInput}
            verificationCode={verificationCode}
            setVerificationCode={setVerificationCode}
            verificationError={verificationError}
            countdown={countdown}
            handleEmailChange={handleEmailChange}
            handleSendCode={handleSendVerificationCode}
            handleResendCode={handleResendCode}
            handleChangeEmail={resetEmail}
            isDisabled={isBusy}
            emailError={emailError}
          />
        </CardContent>

        <CardFooter>
          <Button
            type="submit"
            className="w-full"
            disabled={isBusy || showVerificationInput}
          >
            {isBusy ? t("common.processing") : t("checkout.send_code")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}
