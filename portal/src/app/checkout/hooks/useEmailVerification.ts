import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ApiError, AuthService } from "@/client"
import { dispatchAuthChange } from "@/hooks/useIsAuthenticated"
import { configureApiClient } from "@/lib/api-client"
import { useTenant } from "@/providers/tenantProvider"

interface UseEmailVerificationProps {
  email: string
  onVerificationSuccess: (token: string) => void
}

export const useEmailVerification = ({
  email,
  onVerificationSuccess,
}: UseEmailVerificationProps) => {
  const { t } = useTranslation()
  const { tenantId } = useTenant()
  const [showVerificationInput, setShowVerificationInput] = useState(false)
  const [verificationCode, setVerificationCode] = useState("")
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [isVerifyingCode, setIsVerifyingCode] = useState(false)
  const [verificationError, setVerificationError] = useState<string | null>(
    null,
  )
  const [requiresNewCode, setRequiresNewCode] = useState(false)
  const [verificationNotice, setVerificationNotice] = useState<string | null>(
    null,
  )
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const verificationInFlight = useRef(false)
  const sendingInFlight = useRef(false)
  const lastAttemptedCode = useRef<string | null>(null)

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

  const handleSendVerificationCode = async (isResend = false) => {
    if (sendingInFlight.current || verificationInFlight.current) return
    if (!email) {
      setVerificationError(t("form.email_required"))
      return
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setVerificationError(t("auth.invalid_email"))
      return
    }

    sendingInFlight.current = true
    try {
      setIsSendingCode(true)
      setVerificationError(null)
      setVerificationNotice(null)

      await AuthService.humanLogin({
        requestBody: {
          tenant_id: tenantId ?? "",
          email: email.toLowerCase(),
        },
      })

      setShowVerificationInput(true)
      lastAttemptedCode.current = null
      setVerificationCode("")
      setRequiresNewCode(false)
      if (isResend) {
        setVerificationNotice(t("checkout.verification.resent"))
      }
      startCountdown()
    } catch (error) {
      console.error("Error sending verification code:", error)
      setVerificationError(t("checkout.verification.send_error"))
    } finally {
      sendingInFlight.current = false
      setIsSendingCode(false)
    }
  }

  const handleVerifyCode = useCallback(async () => {
    if (
      verificationInFlight.current ||
      sendingInFlight.current ||
      requiresNewCode
    )
      return
    if (verificationCode.length !== 6) {
      setVerificationError(t("checkout.verification.incomplete"))
      return
    }

    verificationInFlight.current = true
    lastAttemptedCode.current = verificationCode
    try {
      setIsVerifyingCode(true)
      setVerificationError(null)
      setVerificationNotice(null)

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
        const body = error.body as { detail?: unknown } | null
        const detail =
          typeof body?.detail === "string" ? body.detail.toLowerCase() : ""
        if (error.status === 429) {
          setRequiresNewCode(true)
          setVerificationError(t("checkout.verification.too_many_attempts"))
        } else if (error.status < 500 && detail.includes("expired")) {
          setRequiresNewCode(true)
          setVerificationError(t("checkout.verification.expired"))
        } else if (
          error.status === 404 ||
          detail.includes("no authentication code pending") ||
          detail.includes("no pending registration found")
        ) {
          setRequiresNewCode(true)
          setVerificationError(t("checkout.verification.no_active_code"))
        } else if (error.status === 401) {
          setVerificationError(t("checkout.verification.incorrect"))
        } else {
          setVerificationError(t("checkout.verification.server_error"))
        }
      } else {
        setVerificationError(t("checkout.verification.network_error"))
      }
    } finally {
      verificationInFlight.current = false
      setIsVerifyingCode(false)
    }
  }, [
    email,
    verificationCode,
    onVerificationSuccess,
    tenantId,
    requiresNewCode,
    t,
  ])

  useEffect(() => {
    if (verificationCode.length !== 6) {
      lastAttemptedCode.current = null
      return
    }
    // A failed request must stay visible. Returning to idle or re-rendering
    // the caller must not automatically submit the same code again.
    if (
      showVerificationInput &&
      !requiresNewCode &&
      !isVerifyingCode &&
      lastAttemptedCode.current !== verificationCode
    ) {
      handleVerifyCode()
    }
  }, [
    verificationCode,
    handleVerifyCode,
    isVerifyingCode,
    showVerificationInput,
    requiresNewCode,
  ])

  const handleResendCode = async () => {
    await handleSendVerificationCode(true)
  }

  const handleChangeEmail = () => {
    lastAttemptedCode.current = null
    setShowVerificationInput(false)
    setVerificationCode("")
    setVerificationError(null)
    setRequiresNewCode(false)
    setVerificationNotice(null)

    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    setCountdown(0)
  }

  return {
    showVerificationInput,
    verificationCode,
    setVerificationCode,
    isSendingCode,
    isVerifyingCode,
    verificationError,
    requiresNewCode,
    verificationNotice,
    countdown,
    handleSendVerificationCode,
    handleVerifyCode,
    handleResendCode,
    handleChangeEmail,
  }
}
