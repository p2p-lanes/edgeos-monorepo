"use client"

import { motion } from "framer-motion"
import { ArrowRight } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useCityProvider } from "@/providers/cityProvider"

export default function SuccessStep() {
  const router = useRouter()
  const { getCity } = useCityProvider()
  const city = getCity()
  const [countdown, setCountdown] = useState(30)

  const handleGoToPasses = () => {
    if (city?.slug) {
      router.push(`/portal/${city.slug}/passes`)
    } else {
      router.push("/portal")
    }
  }

  useEffect(() => {
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
  }, [handleGoToPasses])

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
        className="text-2xl md:text-3xl font-bold text-gray-900 mb-2"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.9, duration: 0.4 }}
      >
        Payment Successful
      </motion.h1>

      {/* Subtitle */}
      <motion.p
        className="text-gray-500 max-w-xs"
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
        <p className={cn("text-sm", "text-gray-500")}>
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
