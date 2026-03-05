"use client"

import { motion, useInView } from "framer-motion"
import { useRef } from "react"

interface SectionWrapperProps {
  children: React.ReactNode
  className?: string
  title?: string
  subtitle?: string
}

const SectionWrapper = ({
  children,
  className = "",
  title,
  subtitle,
}: SectionWrapperProps) => {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: "-142px" })

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: -60 }}
      animate={isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: -60 }}
      transition={{
        duration: 0.6,
        ease: "backOut",
      }}
      className={`flex flex-col sm:flex-row sm:gap-10 gap-6 pb-12 ${className}`}
    >
      <div className="space-y-1 sm:w-[260px] sm:shrink-0">
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        <p className="text-muted-foreground">{subtitle}</p>
      </div>
      <div className="min-w-0 flex-1 space-y-6">{children}</div>
    </motion.div>
  )
}

export default SectionWrapper
