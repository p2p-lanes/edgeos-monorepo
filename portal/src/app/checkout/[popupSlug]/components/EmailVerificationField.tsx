"use client"

import { Input } from "@edgeos/shared-form-ui"
import { Check, Loader2 } from "lucide-react"
import { useParams } from "next/navigation"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CheckoutService } from "@/client"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"

interface EmailVerificationFieldProps {
  label: string
  required: boolean
  helpText?: string
  value: string
  errorText?: string
  onChange: (value: string) => void
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Email field with inline verification flow:
 *   1. User types a valid email and clicks "Send verification code".
 *   2. POST /api/v1/checkout/{slug}/email-verification/start → backend
 *      emails a 6-digit code.
 *   3. User enters the code; we POST /confirm. On success we mark the
 *      email as verified in the checkout context so the purchase step
 *      can proceed.
 *
 * Editing the email after verification invalidates the verification
 * (the new address would need its own code). The component owns the
 * UI state; the verified-email tuple lives in `useCheckout()`.
 */
export function EmailVerificationField({
  label,
  required,
  helpText,
  value,
  errorText,
  onChange,
}: EmailVerificationFieldProps) {
  const { t } = useTranslation()
  const params = useParams<{ popupSlug: string }>()
  const slug = params?.popupSlug ?? ""
  const { verifiedEmail, setVerifiedEmail } = useCheckout()

  const [stage, setStage] = useState<"idle" | "sent">("idle")
  const [code, setCode] = useState("")
  const [busy, setBusy] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  const trimmed = value.trim()
  const isEmailValid = EMAIL_RE.test(trimmed)
  const isVerified =
    !!verifiedEmail && verifiedEmail.toLowerCase() === trimmed.toLowerCase()

  const reset = () => {
    setStage("idle")
    setCode("")
    setErrorMsg(null)
  }

  const handleSend = async () => {
    if (!isEmailValid) return
    setBusy(true)
    setErrorMsg(null)
    try {
      await CheckoutService.startEmailVerification({
        slug,
        requestBody: { email: trimmed },
      })
      setStage("sent")
    } catch (err) {
      setErrorMsg(
        t("checkout.email_verification.send_failed", {
          defaultValue:
            "Could not send the verification code. Please try again.",
        }),
      )
    } finally {
      setBusy(false)
    }
  }

  const handleConfirm = async () => {
    if (!code.trim()) return
    setBusy(true)
    setErrorMsg(null)
    try {
      const result = await CheckoutService.confirmEmailVerification({
        slug,
        requestBody: { email: trimmed, code: code.trim() },
      })
      if (result?.verified) {
        setVerifiedEmail(trimmed)
        reset()
      } else {
        setErrorMsg(
          t("checkout.email_verification.invalid_code", {
            defaultValue: "Invalid or expired code. Please try again.",
          }),
        )
      }
    } catch (err) {
      setErrorMsg(
        t("checkout.email_verification.confirm_failed", {
          defaultValue: "Could not confirm the code. Please try again.",
        }),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 md:col-span-2">
      <label
        htmlFor="checkout-email"
        className="text-sm font-medium leading-none"
      >
        {label}
        {required ? <span className="text-destructive"> *</span> : null}
      </label>
      {helpText ? (
        <p className="text-sm text-muted-foreground">{helpText}</p>
      ) : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="flex-1">
          <Input
            id="checkout-email"
            type="email"
            value={value}
            onChange={(event) => {
              // Editing the address voids the verified marker for any
              // previous address — the buyer has to re-verify the new
              // value before paying.
              if (verifiedEmail) setVerifiedEmail(null)
              if (stage === "sent") reset()
              onChange(event.target.value)
            }}
            className="w-full"
          />
        </div>

        {isVerified ? (
          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
            <Check className="size-4" />
            {t("checkout.email_verification.verified", {
              defaultValue: "Verified",
            })}
          </span>
        ) : stage === "idle" ? (
          <Button
            type="button"
            variant="outline"
            onClick={handleSend}
            disabled={!isEmailValid || busy}
            className={cn("shrink-0")}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              t("checkout.email_verification.send_code", {
                defaultValue: "Send code",
              })
            )}
          </Button>
        ) : null}
      </div>

      {stage === "sent" && !isVerified ? (
        <div className="rounded-lg border border-border bg-muted/40 p-3 flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label
              htmlFor="checkout-email-code"
              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
            >
              {t("checkout.email_verification.code_label", {
                defaultValue: "Verification code",
              })}
            </label>
            <Input
              id="checkout-email-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              placeholder="123456"
              className="mt-1 tracking-[0.4em] font-mono text-base"
            />
          </div>
          <Button
            type="button"
            onClick={handleConfirm}
            disabled={!code.trim() || busy}
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              t("checkout.email_verification.confirm", {
                defaultValue: "Verify",
              })
            )}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              reset()
              handleSend()
            }}
            disabled={busy}
            className="text-xs"
          >
            {t("checkout.email_verification.resend", {
              defaultValue: "Resend",
            })}
          </Button>
        </div>
      ) : null}

      {errorText ? (
        <p className="text-sm text-destructive">{errorText}</p>
      ) : null}
      {errorMsg ? (
        <p className="text-sm text-destructive">{errorMsg}</p>
      ) : null}
    </div>
  )
}
