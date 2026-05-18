import { useNavigate, useRouter } from "@tanstack/react-router"
import { useCallback } from "react"

type NavigateFn = ReturnType<typeof useNavigate>
type NavigateFallback = Parameters<NavigateFn>[0]

export function useGoBack(fallback: NavigateFallback) {
  const router = useRouter()
  const navigate = useNavigate()

  return useCallback(() => {
    if (router.history.canGoBack()) {
      router.history.back()
    } else {
      navigate(fallback)
    }
  }, [router, navigate, fallback])
}
