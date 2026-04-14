"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { toast } from "sonner"

import { ApiError, GoogleCalendarService } from "@/client"

const STATUS_QUERY_KEY = ["gcal", "status"] as const

export type GoogleCalendarStatus = {
  configured: boolean
  connected: boolean
  calendar_id: string | null
  connected_at: string | null
}

/**
 * Hook for wiring the portal to the Google Calendar OAuth flow.
 *
 * Exposes:
 * - `status`: configured + connected booleans (polled via react-query).
 * - `connect()`: opens the OAuth consent popup and, when it completes,
 *   refetches status and toasts on success.
 * - `disconnect()`: revokes and marks disconnected.
 */
export function useGoogleCalendar() {
  const queryClient = useQueryClient()
  const popupRef = useRef<Window | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const statusQuery = useQuery({
    queryKey: STATUS_QUERY_KEY,
    queryFn: async (): Promise<GoogleCalendarStatus> => {
      try {
        const res = await GoogleCalendarService.statusEndpoint()
        return res as unknown as GoogleCalendarStatus
      } catch (err) {
        if (err instanceof ApiError && err.status === 501) {
          return {
            configured: false,
            connected: false,
            calendar_id: null,
            connected_at: null,
          }
        }
        throw err
      }
    },
    staleTime: 30_000,
  })

  // Listen for message from popup on /portal?gcal=connected
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!event.data || typeof event.data !== "object") return
      if (event.data.type !== "gcal-connected") return
      queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
      toast.success("Google Calendar connected")
    }
    window.addEventListener("message", onMessage)
    return () => {
      window.removeEventListener("message", onMessage)
    }
  }, [queryClient])

  // Clear popup poller on unmount
  useEffect(
    () => () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    },
    [],
  )

  const connectMutation = useMutation({
    mutationFn: async () => {
      const res = await GoogleCalendarService.getAuthUrl()
      return res
    },
    onSuccess: (res) => {
      const authUrl = (res as unknown as { url: string }).url
      const width = 520
      const height = 640
      const left = Math.max(
        0,
        window.screenX + (window.outerWidth - width) / 2,
      )
      const top = Math.max(
        0,
        window.screenY + (window.outerHeight - height) / 2,
      )
      popupRef.current = window.open(
        authUrl,
        "gcal-oauth",
        `width=${width},height=${height},left=${left},top=${top}`,
      )

      // Fallback: poll /status every 2s in case the callback can't postMessage
      // (cross-origin — backend is on a different host in dev).
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
      pollTimerRef.current = setInterval(async () => {
        try {
          const status = await queryClient.fetchQuery({
            queryKey: STATUS_QUERY_KEY,
            queryFn: async () => {
              const s = await GoogleCalendarService.statusEndpoint()
              return s as unknown as GoogleCalendarStatus
            },
          })
          if (status.connected) {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current)
            pollTimerRef.current = null
            if (popupRef.current && !popupRef.current.closed) {
              popupRef.current.close()
            }
            toast.success("Google Calendar connected")
          } else if (popupRef.current && popupRef.current.closed) {
            // user closed the popup without completing
            if (pollTimerRef.current) clearInterval(pollTimerRef.current)
            pollTimerRef.current = null
          }
        } catch {
          // ignore — next tick will retry
        }
      }, 2000)
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 501) {
        toast.error("Google Calendar is not configured on this server")
        return
      }
      toast.error("Failed to start Google sign-in")
    },
  })

  const disconnectMutation = useMutation({
    mutationFn: () => GoogleCalendarService.disconnect(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: STATUS_QUERY_KEY })
      toast.success("Google Calendar disconnected")
    },
    onError: () => toast.error("Failed to disconnect Google Calendar"),
  })

  return {
    status: statusQuery.data,
    isLoading: statusQuery.isLoading,
    connect: connectMutation.mutate,
    isConnecting: connectMutation.isPending,
    disconnect: disconnectMutation.mutate,
    isDisconnecting: disconnectMutation.isPending,
  }
}
