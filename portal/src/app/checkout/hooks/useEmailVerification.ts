import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ApiError, AuthService } from "@/client"
import { dispatchAuthChange } from "@/hooks/useIsAuthenticated"
import { configureApiClient } from "@/lib/api-client"
import { useTenant } from "@/providers/tenantProvider"

interface UseEmailVerificationProps {
  popupId: string
  otpEnabled: boolean
  email: string
  onVerificationSuccess: (token: string) => void
}

const OTP_REQUIRED_CODE = "otp_required"

function isOtpRequiredError(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return false
  }
  const detail = (error.body as { detail?: unknown } | undefined)?.detail
  if (detail && typeof detail === "object" && "code" in detail) {
    return (detail as { code?: unknown }).code === OTP_REQUIRED_CODE
  }
  return false
}

export const useEmailVerification = ({
  popupId,
  otpEnabled,
  email,
  onVerificationSuccess,
}: UseEmailVerificationProps) => {
  const { t } = useTranslation()
  const { tenantId } = useTenant()
  const [otpRequiredFallback, setOtpRequiredFallback] = useState(false)
  const [showVerificationInput, setShowVerificationInput] = useState(false)
  const [verificationCode, setVerificationCode] = useState("")
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [isVerifyingCode, setIsVerifyingCode] = useState(false)
  const [verificationError, setVerificationError] = useState<string | null>(
    null,
  )
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

  // Once the backend forces OTP for this email (existing account), keep using
  // the OTP flow even if the popup itself has the no-OTP shortcut enabled.
  const effectiveOtpEnabled = otpEnabled || otpRequiredFallback

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current)
      }
    }
  }, [])

  const startCountdown = () => {
    setCountdown(60)

    if (timerRef.current) {
      clearInterval(timerRef.current)
    }

    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current)
          }
          return 0
        }
        return prev - 1
      })
    }, 1000)
  }

  const sendOtpLogin = async () => {
    await AuthService.humanLogin({
      requestBody: {
        tenant_id: tenantId ?? "",
        email: email.toLowerCase(),
      },
    })
    setShowVerificationInput(true)
    startCountdown()
  }

  const handleSendVerificationCode = async () => {
    if (!email) {
      setVerificationError(t("auth.email_required", "Email is required"))
      return
    }

    if (effectiveOtpEnabled && !/^\S+@\S+\.\S+$/.test(email)) {
      setVerificationError(t("auth.invalid_email"))
      return
    }

    try {
      setIsSendingCode(true)
      setVerificationError(null)

      if (!effectiveOtpEnabled) {
        try {
          const result = await AuthService.humanCheckoutAuthenticate({
            requestBody: {
              popup_id: popupId,
              email: email.toLowerCase(),
            },
          })

          const token = result.access_token
          configureApiClient(token)
          window?.localStorage?.setItem("token", token)
          dispatchAuthChange()
          setShowVerificationInput(false)
          onVerificationSuccess(token)
          return
        } catch (error) {
          if (!isOtpRequiredError(error)) {
            throw error
          }
          // Backend told us this email already has an account in the
          // tenant. The no-OTP shortcut is no longer safe — fall back to
          // the regular OTP flow transparently.
          setOtpRequiredFallback(true)
          setVerificationError(
            t("auth.otp_required_for_existing_account"),
          )
          await sendOtpLogin()
          return
        }
      }

      await sendOtpLogin()
    } catch (error) {
      console.error("Error sending verification code:", error)
      setVerificationError(t("auth.failed_to_send_code"))
    } finally {
      setIsSendingCode(false)
    }
  }

  const handleVerifyCode = useCallback(async () => {
    if (verificationCode.length !== 6) {
      setVerificationError(t("auth.code_must_be_6_digits"))
      return
    }

    try {
      setIsVerifyingCode(true)
      setVerificationError(null)

      const result = await AuthService.humanAuthenticate({
        requestBody: {
          email: email.toLowerCase(),
          tenant_id: tenantId ?? "",
          code: verificationCode,
        },
      })

      const token = result.access_token
      configureApiClient(token)
      window?.localStorage?.setItem("token", token)
      dispatchAuthChange()

      setVerificationError(null)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setCountdown(0)
      setShowVerificationInput(false)

      onVerificationSuccess(token)
    } catch (error: unknown) {
      console.error("Error verifying code:", error)

      if (error instanceof ApiError) {
        if (error.status === 401) {
          setVerificationError(t("auth.invalid_code"))
        } else if (error.status === 404) {
          setVerificationError(t("auth.code_expired"))
        } else {
          setVerificationError(t("auth.failed_to_verify"))
        }
      } else {
        setVerificationError(t("auth.network_error"))
      }
    } finally {
      setIsVerifyingCode(false)
    }
  }, [email, verificationCode, onVerificationSuccess, tenantId, t])

  useEffect(() => {
    if (
      verificationCode.length === 6 &&
      showVerificationInput &&
      !isVerifyingCode
    ) {
      handleVerifyCode()
    }
  }, [
    verificationCode,
    handleVerifyCode,
    isVerifyingCode,
    showVerificationInput,
  ])

  const handleResendCode = async () => {
    try {
      setVerificationCode("")
      setVerificationError(null)
      await handleSendVerificationCode()
    } catch (error) {
      console.error("Error resending code:", error)
      setVerificationError(t("auth.failed_to_send_code"))
    }
  }

  const handleChangeEmail = () => {
    setShowVerificationInput(false)
    setVerificationCode("")
    setVerificationError(null)
    setOtpRequiredFallback(false)

    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setCountdown(0)
  }

  return {
    otpEnabled: effectiveOtpEnabled,
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
  }
}
