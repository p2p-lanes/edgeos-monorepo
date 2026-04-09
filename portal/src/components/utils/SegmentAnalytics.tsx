"use client"

import { AnalyticsBrowser } from "@segment/analytics-next"
import { usePathname, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useRef } from "react"

const writeKey = process.env.NEXT_PUBLIC_SEGMENT_WRITE_KEY ?? ""

const analytics = writeKey ? AnalyticsBrowser.load({ writeKey }) : null

function PageTracker() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const prev = useRef("")

  useEffect(() => {
    if (!analytics) return
    const url = pathname + (searchParams?.toString() ? `?${searchParams}` : "")
    if (url === prev.current) return
    prev.current = url
    analytics.page()
  }, [pathname, searchParams])

  return null
}

export { analytics }

export default function SegmentAnalytics() {
  if (!writeKey) return null
  return (
    <Suspense>
      <PageTracker />
    </Suspense>
  )
}
