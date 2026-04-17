"use client"

import gsap from "gsap"
import { useEffect, useRef, useState } from "react"

export default function SnapSection({
  id,
  children,
  bottomPadding = "50vh",
}: {
  id: string
  children: React.ReactNode
  bottomPadding?: string
}) {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { threshold: 0.3 },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const watermarkChars = Array.from(
      el.querySelectorAll<HTMLElement>("[data-watermark-char]"),
    )
    const titleEl = el.querySelector<HTMLElement>("[data-section-title]")
    const subtitleEl = el.querySelector<HTMLElement>("[data-section-subtitle]")

    if (visible) {
      if (watermarkChars.length > 0) {
        gsap.fromTo(
          watermarkChars,
          { opacity: 0, y: 60, filter: "blur(8px)" },
          {
            opacity: 1,
            y: 0,
            filter: "blur(0px)",
            duration: 0.7,
            ease: "power3.out",
            stagger: { each: 0.04, from: "start" },
          },
        )
      }
      if (titleEl) {
        gsap.fromTo(
          titleEl,
          { opacity: 0, x: -32 },
          { opacity: 1, x: 0, duration: 0.55, ease: "power2.out", delay: 0.1 },
        )
      }
      if (subtitleEl) {
        gsap.fromTo(
          subtitleEl,
          { opacity: 0, y: 8 },
          { opacity: 1, y: 0, duration: 0.45, ease: "power1.out", delay: 0.3 },
        )
      }
    } else {
      if (watermarkChars.length > 0) {
        gsap.set(watermarkChars, { opacity: 0, y: 60, filter: "blur(8px)" })
      }
      if (titleEl) {
        gsap.set(titleEl, { opacity: 0, x: -32 })
      }
      if (subtitleEl) {
        gsap.set(subtitleEl, { opacity: 0, y: 8 })
      }
    }

    return () => {
      gsap.killTweensOf(
        [...watermarkChars, titleEl, subtitleEl].filter(Boolean),
      )
    }
  }, [visible])

  return (
    <section
      id={id}
      ref={ref}
      className="flex flex-col justify-start px-4 max-w-2xl mx-auto"
      style={{
        minHeight: "var(--snap-section-h, 100vh)",
        paddingTop: "calc(var(--snap-nav-h, 48px) + 1.5rem)",
        paddingBottom: bottomPadding,
      }}
    >
      {children}
    </section>
  )
}
