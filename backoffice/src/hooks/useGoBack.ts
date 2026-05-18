import { useNavigate, useRouter } from "@tanstack/react-router"
import { useCallback } from "react"

type Fallback = { to: string } | (() => void)

export function useGoBack(fallback: Fallback) {
  const router = useRouter()
  const navigate = useNavigate()

  return useCallback(() => {
    if (router.history.canGoBack()) {
      router.history.back()
    } else if (typeof fallback === "function") {
      fallback()
    } else {
      navigate({ to: fallback.to })
    }
  }, [router, navigate, fallback])
}
