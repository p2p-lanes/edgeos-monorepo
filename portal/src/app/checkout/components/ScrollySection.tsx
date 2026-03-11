"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

interface ScrollySectionProps {
  id: string
  children: React.ReactNode
  className?: string
}

export default function ScrollySection({
  id,
  children,
  className,
}: ScrollySectionProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    // Find the actual scroll container (portal layout uses <main> with overflow-y-auto)
    let root: Element | null = null
    let parent = el.parentElement
    while (parent && parent !== document.body) {
      const style = window.getComputedStyle(parent)
      if (
        style.overflow.includes("auto") ||
        style.overflow.includes("scroll") ||
        style.overflowY.includes("auto") ||
        style.overflowY.includes("scroll")
      ) {
        root = parent
        break
      }
      parent = parent.parentElement
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setVisible(true)
            observer.disconnect()
          }
        }
      },
      { root, threshold: 0.05 },
    )

    observer.observe(el)

    return () => {
      observer.disconnect()
    }
  }, [])

  return (
    <section
      id={id}
      ref={ref}
      className={cn(
        "mb-8 transition-all duration-700 ease-out",
        visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-10",
        className,
      )}
    >
      {children}
    </section>
  )
}
