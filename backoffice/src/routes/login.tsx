import { useForm } from "@tanstack/react-form"
import { createFileRoute, redirect } from "@tanstack/react-router"
import { useState } from "react"
import { z } from "zod"

import { AuthLayout } from "@/components/Common/AuthLayout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import useAuth, { isLoggedIn } from "@/hooks/useAuth"

// Validation schemas
const emailSchema = z.email("Please enter a valid email address")
const codeSchema = z
  .string()
  .length(6, "Code must be 6 digits")
  .regex(/^\d+$/, "Code must contain only numbers")

export const Route = createFileRoute("/login")({
  component: Login,
  beforeLoad: async () => {
    if (isLoggedIn()) {
      throw redirect({
        to: "/",
      })
    }
  },
  head: () => ({
    meta: [
      {
        title: "Log In - EdgeOS",
      },
    ],
  }),
})

function Login() {
  const { requestCodeMutation, verifyCodeMutation } = useAuth()
  const [step, setStep] = useState<"email" | "verify">("email")
  const [submittedEmail, setSubmittedEmail] = useState("")

  // Email form (Step 1)
  const emailForm = useForm({
    defaultValues: {
      email: "",
    },
    onSubmit: ({ value }) => {
      if (requestCodeMutation.isPending) return
      requestCodeMutation.mutate(
        { email: value.email },
        {
          onSuccess: () => {
            setSubmittedEmail(value.email)
            verifyForm.reset()
            setStep("verify")
          },
        },
      )
    },
  })

  // Verification form (Step 2)
  const verifyForm = useForm({
    defaultValues: {
      code: "",
    },
    onSubmit: ({ value }) => {
      if (verifyCodeMutation.isPending) return
      verifyCodeMutation.mutate({
        email: submittedEmail,
        code: value.code,
      })
    },
  })

  const handleBackToEmail = () => {
    setStep("email")
    verifyForm.reset()
  }

  const handleResendCode = () => {
    requestCodeMutation.mutate({ email: submittedEmail })
  }

  return (
    <AuthLayout>
      {step === "email" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            emailForm.handleSubmit()
          }}
          className="flex flex-col gap-6"
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-bold">Login to Your Account</h1>
            <p className="text-muted-foreground text-sm">
              Enter your email to receive a verification code
            </p>
          </div>

          <div className="grid gap-4">
            <emailForm.Field
              name="email"
              validators={{
                onBlur: ({ value }) => {
                  const result = emailSchema.safeParse(value)
                  return result.success
                    ? undefined
                    : result.error.issues[0].message
                },
              }}
            >
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor={field.name}>Email</Label>
                  <Input
                    id={field.name}
                    data-testid="email-input"
                    placeholder="user@example.com"
                    type="email"
                    autoComplete="email"
                    spellCheck={false}
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-xs">
                      {field.state.meta.errors.join(", ")}
                    </p>
                  )}
                </div>
              )}
            </emailForm.Field>

            <LoadingButton
              type="submit"
              loading={requestCodeMutation.isPending}
              className="w-full"
            >
              Send Verification Code
            </LoadingButton>
          </div>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            verifyForm.handleSubmit()
          }}
          className="flex flex-col gap-6"
        >
          <div className="flex flex-col items-center gap-2 text-center">
            <h1 className="text-2xl font-bold">Enter Verification Code</h1>
            <p className="text-muted-foreground text-sm">
              We sent a 6-digit code to{" "}
              <span className="font-medium text-foreground">
                {submittedEmail}
              </span>
            </p>
          </div>

          <div className="grid gap-4">
            <verifyForm.Field
              name="code"
              validators={{
                onBlur: ({ value }) => {
                  const result = codeSchema.safeParse(value)
                  return result.success
                    ? undefined
                    : result.error.issues[0].message
                },
              }}
            >
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor={field.name}>Verification Code</Label>
                  <Input
                    id={field.name}
                    data-testid="code-input"
                    placeholder="000000"
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    autoFocus
                    className="text-center text-2xl tracking-widest"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-xs">
                      {field.state.meta.errors.join(", ")}
                    </p>
                  )}
                </div>
              )}
            </verifyForm.Field>

            <LoadingButton
              type="submit"
              loading={verifyCodeMutation.isPending}
              className="w-full"
            >
              Verify and Log In
            </LoadingButton>

            <div className="flex flex-col gap-2 text-center text-sm">
              <Button
                type="button"
                variant="link"
                onClick={handleResendCode}
                disabled={requestCodeMutation.isPending}
                className="text-muted-foreground"
              >
                {requestCodeMutation.isPending ? "Sending..." : "Resend code"}
              </Button>
              <Button
                type="button"
                variant="link"
                onClick={handleBackToEmail}
                className="text-muted-foreground"
              >
                Use a different email
              </Button>
            </div>
          </div>
        </form>
      )}
    </AuthLayout>
  )
}
