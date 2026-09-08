import { useCallback, useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import type { PortalSession } from "@/lib/session-contract"
import { authRequest, SessionRequestError } from "@/lib/session-lifecycle"
import { useSession } from "@/providers/sessionProvider"

interface UseEmailVerificationProps {
  email: string
  onVerificationSuccess: (session: PortalSession) => void
}

export const useEmailVerification = ({
  email,
  onVerificationSuccess,
}: UseEmailVerificationProps) => {
  const { lifecycle } = useSession()
  const { t } = useTranslation()
  const [showVerificationInput, setShowVerificationInput] = useState(false)
  const [verificationCode, setVerificationCode] = useState("")
  const [isSendingCode, setIsSendingCode] = useState(false)
  const [isVerifyingCode, setIsVerifyingCode] = useState(false)
  const [verificationError, setVerificationError] = useState<string | null>(
    null,
  )
  const [countdown, setCountdown] = useState(0)
  const timerRef = useRef<NodeJS.Timeout | null>(null)

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

  const handleSendVerificationCode = async () => {
    if (!email) {
      setVerificationError(t("auth.invalid_email"))
      return
    }

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      setVerificationError(t("auth.invalid_email"))
      return
    }

    try {
      setIsSendingCode(true)
      setVerificationError(null)

      await authRequest("login", { email: email.toLowerCase() })

      setShowVerificationInput(true)
      startCountdown()
    } catch {
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

      const session = await lifecycle.verify(
        email.toLowerCase(),
        verificationCode,
      )

      setVerificationError(null)
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setCountdown(0)
      setShowVerificationInput(false)

      onVerificationSuccess(session)
    } catch (error: unknown) {
      setVerificationCode("")
      if (error instanceof SessionRequestError) {
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
  }, [email, verificationCode, onVerificationSuccess, lifecycle, t])

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
    } catch {
      setVerificationError(t("auth.failed_to_send_code"))
    }
  }

  const handleChangeEmail = () => {
    setShowVerificationInput(false)
    setVerificationCode("")
    setVerificationError(null)

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
    countdown,
    handleSendVerificationCode,
    handleVerifyCode,
    handleResendCode,
    handleChangeEmail,
  }
}
