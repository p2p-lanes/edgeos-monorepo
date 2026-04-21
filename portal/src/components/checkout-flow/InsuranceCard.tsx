"use client"

import { AnimatePresence, motion } from "framer-motion"
import { Check, Umbrella } from "lucide-react"
import { cn } from "@/lib/utils"
import { formatCurrency, INSURANCE_BENEFITS } from "@/types/checkout"

interface InsuranceCardProps {
  insurance: boolean
  price: number
  onToggle: () => void
  /** Custom card title. Defaults to "Insurance". */
  title?: string
  /** Custom subtitle shown next to the price. Defaults to "Change of plans coverage". */
  subtitle?: string
  /** Accessible label for the toggle button. Defaults to "Toggle insurance". */
  toggleLabel?: string
  /** Custom benefits list. Defaults to INSURANCE_BENEFITS constant. */
  benefits?: string[]
}

export default function InsuranceCard({
  insurance,
  price,
  onToggle,
  title = "Insurance",
  subtitle = "Change of plans coverage",
  toggleLabel = "Toggle insurance",
  benefits = INSURANCE_BENEFITS,
}: InsuranceCardProps) {
  return (
    <motion.div
      whileHover={{ y: -1 }}
      transition={{ type: "spring", stiffness: 400, damping: 25 }}
      className="bg-white rounded-2xl border border-gray-100 border-l-4 border-l-amber-400 p-5 shadow-sm"
    >
      <div className="flex items-start gap-3">
        <motion.div
          animate={{ rotate: insurance ? 0 : -20 }}
          transition={{ type: "spring", stiffness: 300, damping: 15 }}
          className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center shrink-0"
        >
          <Umbrella className="w-5 h-5 text-amber-500" />
        </motion.div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-gray-900">{title}</h3>
              <p className="text-sm text-gray-500 mt-0.5">
                {formatCurrency(price)} · {subtitle}
              </p>
            </div>
            <button
              type="button"
              onClick={onToggle}
              role="switch"
              aria-checked={insurance}
              aria-label={toggleLabel}
              className={cn(
                "relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0",
                insurance ? "bg-amber-400" : "bg-gray-200",
              )}
            >
              <motion.span
                layout
                transition={{ type: "spring", stiffness: 500, damping: 30 }}
                className={cn(
                  "inline-block h-4 w-4 rounded-full bg-white shadow-sm",
                  insurance ? "ml-6" : "ml-1",
                )}
              />
            </button>
          </div>

          <ul className="text-xs text-gray-500 mt-3 space-y-1">
            {benefits.map((b) => (
              <li key={b} className="flex items-center gap-2">
                <AnimatePresence mode="wait" initial={false}>
                  <motion.span
                    key={insurance ? "check" : "dot"}
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    exit={{ scale: 0 }}
                    transition={{ type: "spring", stiffness: 500, damping: 25 }}
                    className="shrink-0"
                  >
                    {insurance ? (
                      <Check className="w-3.5 h-3.5 text-green-500" />
                    ) : (
                      <span className="block w-1.5 h-1.5 rounded-full bg-gray-300" />
                    )}
                  </motion.span>
                </AnimatePresence>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </motion.div>
  )
}
