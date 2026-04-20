"use client"

import { motion } from "framer-motion"
import {
  AlertCircle,
  ArrowRight,
  Clock,
  Loader2,
  RefreshCw,
} from "lucide-react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import type { VerifiedPaymentStatus } from "@/hooks/checkout"
import { cn } from "@/lib/utils"
import { useCityProvider } from "@/providers/cityProvider"

interface SuccessStepProps {
  paymentStatus?: VerifiedPaymentStatus
}

export default function SuccessStep({
  paymentStatus = "approved",
}: SuccessStepProps) {
  const router = useRouter()
  const { getCity } = useCityProvider()
  const city = getCity()
  const [countdown, setCountdown] = useState(30)

  const passesUrl = city?.slug ? `/portal/${city.slug}/passes` : "/portal"

  const handleGoToPasses = useCallback(() => {
    router.push(passesUrl)
  }, [passesUrl, router])

  const handleRetry = useCallback(() => {
    router.push(city?.slug ? `/portal/${city.slug}/passes/buy` : "/portal")
  }, [city?.slug, router])

  // Only countdown when payment is approved
  useEffect(() => {
    if (paymentStatus !== "approved") return

    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          handleGoToPasses()
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [paymentStatus, handleGoToPasses])

  // Verifying state
  if (paymentStatus === "verifying") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[55vh] text-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col items-center"
        >
          <Loader2 className="w-16 h-16 text-primary animate-spin mb-6" />
          <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Verifying your payment...
          </h1>
          <p className="text-muted-foreground max-w-xs">
            Please wait while we confirm your payment with the provider.
          </p>
        </motion.div>
      </div>
    )
  }

  // Pending state (max retries reached, still processing)
  if (paymentStatus === "pending") {
    return (
      <div className="flex flex-col items-center justify-center min-h-[55vh] text-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col items-center"
        >
          <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mb-6">
            <Clock className="w-8 h-8 text-amber-600" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Payment Still Processing
          </h1>
          <p className="text-muted-foreground max-w-sm">
            Your payment is still being processed. You will receive a
            confirmation email shortly once it is completed.
          </p>
          <div className="mt-8">
            <Button onClick={handleGoToPasses}>
              Go to My Passes
              <ArrowRight className="w-4 h-4" />
            </Button>
          </div>
        </motion.div>
      </div>
    )
  }

  // Rejected / Expired / Cancelled / Error states
  if (
    paymentStatus === "rejected" ||
    paymentStatus === "expired" ||
    paymentStatus === "cancelled" ||
    paymentStatus === "error"
  ) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[55vh] text-center px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.4 }}
          className="flex flex-col items-center"
        >
          <div className="w-16 h-16 rounded-full bg-destructive/20 flex items-center justify-center mb-6">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <h1 className="text-2xl md:text-3xl font-bold text-foreground mb-2">
            Payment was not completed
          </h1>
          <p className="text-muted-foreground max-w-sm">
            {paymentStatus === "error"
              ? "We could not verify your payment status. Please check your email or try again."
              : "Your payment was not processed successfully. Please try again."}
          </p>
          <div className="flex flex-col items-center gap-3 mt-8">
            <Button onClick={handleRetry}>
              <RefreshCw className="w-4 h-4" />
              Try Again
            </Button>
            <Button variant="ghost" onClick={handleGoToPasses}>
              Go to My Passes
            </Button>
          </div>
        </motion.div>
      </div>
    )
  }

  // Approved state (default) — original success animation
  return (
    <div className="flex flex-col items-center justify-center min-h-[55vh] text-center px-4">
      {/* Pulse ring */}
      <motion.div
        className="absolute w-32 h-32 rounded-full border-2 border-green-300"
        initial={{ scale: 0.6, opacity: 0.8 }}
        animate={{ scale: 2.5, opacity: 0 }}
        transition={{
          duration: 2,
          ease: "easeOut",
          repeat: Number.POSITIVE_INFINITY,
          repeatDelay: 1,
        }}
      />

      {/* SVG check circle */}
      <div className="relative w-24 h-24 mb-8">
        <svg viewBox="0 0 100 100" className="w-full h-full" aria-hidden="true">
          <motion.circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="#16a34a"
            strokeWidth="3"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.8, ease: "easeInOut" }}
          />
          <motion.path
            d="M30 52 L44 66 L70 38"
            fill="none"
            stroke="#16a34a"
            strokeWidth="4"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.5, ease: "easeOut" }}
          />
        </svg>
      </div>

      {/* Title */}
      <motion.h1
        className="text-2xl md:text-3xl font-bold text-foreground mb-2"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9, duration: 0.4 }}
      >
        Payment Successful
      </motion.h1>

      {/* Subtitle */}
      <motion.p
        className="text-muted-foreground max-w-xs"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.1, duration: 0.4 }}
      >
        Your passes are ready and waiting for you.
      </motion.p>

      {/* Footer */}
      <motion.div
        className="flex flex-col items-center gap-3 mt-8"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1.8, duration: 0.4 }}
      >
        <p className={cn("text-sm", "text-muted-foreground")}>
          Redirecting in {countdown}s...
        </p>
        <Button onClick={handleGoToPasses}>
          Go to My Passes
          <ArrowRight className="w-4 h-4" />
        </Button>
      </motion.div>
    </div>
  )
}
