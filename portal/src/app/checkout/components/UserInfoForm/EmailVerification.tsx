import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { LabelRequired } from "@/components/ui/label"
import { OtpInput } from "@/components/ui/otp-input"

interface EmailVerificationProps {
  email: string
  showVerificationInput: boolean
  verificationCode: string
  setVerificationCode: (code: string) => void
  verificationError: string | null
  countdown: number
  handleEmailChange: (value: string) => void
  handleSendCode: () => void
  handleResendCode: () => void
  handleChangeEmail: () => void
  isDisabled: boolean
  emailError?: string
}

const EmailVerification = ({
  email,
  showVerificationInput,
  verificationCode,
  setVerificationCode,
  verificationError,
  countdown,
  handleEmailChange,
  handleSendCode: _handleSendCode,
  handleResendCode,
  handleChangeEmail,
  isDisabled: _isDisabled,
  emailError,
}: EmailVerificationProps) => {
  const { t } = useTranslation()

  return (
    <div className="space-y-4">
      <div className="w-full flex items-center justify-between">
        <div className="w-full flex flex-col gap-2">
          <div className="flex flex-col gap-2">
            <LabelRequired isRequired={true}>{t("common.email")}</LabelRequired>
          </div>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => handleEmailChange(e.target.value)}
            error={emailError}
            required
            placeholder={t("form.email_placeholder")}
            disabled={showVerificationInput}
            className="w-full"
          />
        </div>

        {showVerificationInput && (
          <Button
            type="button"
            variant="link"
            size="default"
            className="mt-[21px]"
            onClick={handleChangeEmail}
          >
            {t("form.change_email")}
          </Button>
        )}
      </div>

      {showVerificationInput && (
        <div className="space-y-2">
          <div className="flex flex-col items-center space-y-3">
            <p className="text-sm text-center">
              {t("checkout.email_verification_sent", { email })}
            </p>
            <OtpInput
              value={verificationCode}
              onChange={setVerificationCode}
              error={verificationError || undefined}
            />

            <div className="flex mt-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleResendCode}
                disabled={countdown > 0}
                className="text-xs ml-auto"
              >
                {countdown > 0
                  ? t("checkout.resend_code_countdown", { countdown })
                  : t("checkout.resend_code")}
              </Button>
            </div>

            {verificationError && (
              <p className="text-sm text-red-500 text-center">
                {verificationError}
              </p>
            )}
            <p className="text-xs text-muted-foreground text-center mt-1">
              {t("checkout.resend_hint")}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

export default EmailVerification
