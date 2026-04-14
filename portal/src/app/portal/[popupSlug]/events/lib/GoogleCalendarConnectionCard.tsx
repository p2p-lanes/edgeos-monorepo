"use client"

import { CalendarCheck, CalendarX, Link2Off, LogIn } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useGoogleCalendar } from "./useGoogleCalendar"

/**
 * Connect/disconnect card for Google Calendar sync. Lives at the top of
 * the events page. Hides itself entirely if the server has not been
 * configured with GOOGLE_OAUTH_* env vars (status returns configured=false).
 */
export function GoogleCalendarConnectionCard() {
  const {
    status,
    isLoading,
    connect,
    isConnecting,
    disconnect,
    isDisconnecting,
  } = useGoogleCalendar()

  if (isLoading || !status) return null
  if (!status.configured) return null

  if (status.connected) {
    return (
      <div className="rounded-xl border bg-card p-3 flex items-center gap-3">
        <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center">
          <CalendarCheck className="h-4 w-4 text-green-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium">Google Calendar connected</p>
          <p className="text-xs text-muted-foreground">
            RSVPs are pushed to your calendar automatically.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => disconnect()}
          disabled={isDisconnecting}
        >
          <Link2Off className="mr-2 h-3.5 w-3.5" />
          Disconnect
        </Button>
      </div>
    )
  }

  return (
    <div className="rounded-xl border bg-card p-3 flex items-center gap-3">
      <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
        <CalendarX className="h-4 w-4 text-blue-600" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium">Google Calendar not connected</p>
        <p className="text-xs text-muted-foreground">
          Connect to have events show up automatically in your calendar.
        </p>
      </div>
      <Button size="sm" onClick={() => connect()} disabled={isConnecting}>
        <LogIn className="mr-2 h-3.5 w-3.5" />
        Connect
      </Button>
    </div>
  )
}
