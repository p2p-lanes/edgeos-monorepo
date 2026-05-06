import { useMutation } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Package,
  QrCode,
  RefreshCw,
  User,
} from "lucide-react"
import { useRef, useState } from "react"

import { AttendeesService, type TicketPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { InlineRow, InlineSection } from "@/components/ui/inline-form"
import { Separator } from "@/components/ui/separator"
import { createErrorHandler } from "@/utils"
import useCustomToast from "@/hooks/useCustomToast"

export const Route = createFileRoute("/_layout/scan")({
  component: Scan,
  head: () => ({
    meta: [{ title: "Scan Ticket - EdgeOS" }],
  }),
})

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "N/A"
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
}

/** Exported for tests */
export function TicketScanResult({ ticket }: { ticket: TicketPublic }) {
  const isFirstScan = (ticket.total_scans ?? 0) <= 1
  const scanCount = ticket.total_scans ?? 1

  return (
    <div className="space-y-4 mt-4">
      {/* Scan verdict banner */}
      {isFirstScan ? (
        <div className="flex items-center gap-3 rounded-lg bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-300 p-4">
          <CheckCircle className="h-5 w-5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-sm">First check-in!</p>
            <p className="text-xs opacity-80">This ticket has not been scanned before.</p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-lg bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 p-4">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-sm">Re-scan #{scanCount}</p>
            <p className="text-xs opacity-80">
              This ticket has already been scanned {scanCount - 1} time{scanCount - 1 !== 1 ? "s" : ""}.
            </p>
          </div>
        </div>
      )}

      {/* Ticket details */}
      <div className="rounded-lg border bg-card">
        {/* Ticket code header */}
        <div className="px-6 py-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
            <QrCode className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="font-mono text-lg font-semibold">{ticket.check_in_code}</p>
            <p className="text-xs text-muted-foreground">Ticket ID: {ticket.id.slice(0, 8)}…</p>
          </div>
        </div>

        <Separator />

        {/* Product info */}
        <InlineSection title="Product" className="px-6 py-4">
          <InlineRow
            icon={<Package className="h-4 w-4 text-muted-foreground" />}
            label="Name"
          >
            <span className="text-sm font-medium">{ticket.product.name}</span>
          </InlineRow>
          <InlineRow
            icon={<Package className="h-4 w-4 text-muted-foreground" />}
            label="Category"
          >
            <Badge variant="secondary">{ticket.product.category ?? "—"}</Badge>
          </InlineRow>
          {ticket.product.start_date && ticket.product.end_date && (
            <InlineRow
              icon={<Clock className="h-4 w-4 text-muted-foreground" />}
              label="Valid"
            >
              <span className="text-sm text-muted-foreground">
                {new Date(ticket.product.start_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                {" to "}
                {new Date(ticket.product.end_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </span>
            </InlineRow>
          )}
        </InlineSection>

        <Separator />

        {/* Attendee info */}
        <InlineSection title="Attendee" className="px-6 py-4">
          <InlineRow
            icon={<User className="h-4 w-4 text-muted-foreground" />}
            label="Name"
          >
            <span className="text-sm font-medium">{ticket.attendee.name}</span>
          </InlineRow>
          {ticket.attendee.email && (
            <InlineRow
              icon={<User className="h-4 w-4 text-muted-foreground" />}
              label="Email"
            >
              <span className="text-sm text-muted-foreground">{ticket.attendee.email}</span>
            </InlineRow>
          )}
          <InlineRow
            icon={<User className="h-4 w-4 text-muted-foreground" />}
            label="Category"
          >
            <Badge variant="outline" className="capitalize">{ticket.attendee.category}</Badge>
          </InlineRow>
        </InlineSection>

        <Separator />

        {/* Scan history */}
        <InlineSection title="Scan History" className="px-6 py-4">
          <InlineRow
            icon={<RefreshCw className="h-4 w-4 text-muted-foreground" />}
            label="Total scans"
          >
            <span className="text-sm font-medium">{scanCount}</span>
          </InlineRow>
          <InlineRow
            icon={<Clock className="h-4 w-4 text-muted-foreground" />}
            label="First scan"
          >
            <span className="text-sm text-muted-foreground">{formatDateTime(ticket.first_scan_at)}</span>
          </InlineRow>
          {(ticket.total_scans ?? 0) > 1 && (
            <InlineRow
              icon={<Clock className="h-4 w-4 text-muted-foreground" />}
              label="Latest scan"
            >
              <span className="text-sm text-muted-foreground">{formatDateTime(ticket.last_scan_at)}</span>
            </InlineRow>
          )}
        </InlineSection>
      </div>
    </div>
  )
}

function Scan() {
  const [code, setCode] = useState("")
  const [scannedTicket, setScannedTicket] = useState<TicketPublic | null>(null)
  const [notFound, setNotFound] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const { showErrorToast } = useCustomToast()

  const scanMutation = useMutation({
    mutationFn: ({ code }: { code: string }) =>
      AttendeesService.getByCheckInCode({
        code: code.toUpperCase().trim(),
        requestBody: { source: "manual" },
      }),
    onSuccess: (ticket) => {
      setScannedTicket(ticket)
      setNotFound(false)
      setCode("")
      setTimeout(() => inputRef.current?.focus(), 50)
    },
    onError: (err: unknown) => {
      const status = (err as { status?: number })?.status
      if (status === 404) {
        setNotFound(true)
        setScannedTicket(null)
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        createErrorHandler(showErrorToast)(err as any)
      }
      setCode("")
      setTimeout(() => inputRef.current?.focus(), 50)
    },
  })

  const handleScan = (overrideCode?: string) => {
    const target = (overrideCode ?? code).toUpperCase().trim()
    if (!target) return
    setNotFound(false)
    scanMutation.mutate({ code: target })
  }

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Scan Ticket</h1>
        <p className="text-muted-foreground">
          Enter or scan a check-in code to record attendance
        </p>
      </div>

      {/* Scan input */}
      <div className="flex gap-2">
        <Input
          ref={inputRef}
          placeholder="Enter check-in code…"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleScan()
          }}
          autoFocus
          className="font-mono text-base"
          aria-label="Check-in code"
        />
        <Button
          onClick={() => handleScan()}
          disabled={!code.trim() || scanMutation.isPending}
        >
          {scanMutation.isPending ? "Scanning…" : "Scan"}
        </Button>
      </div>

      {/* Not found error */}
      {notFound && (
        <div className="flex items-center gap-3 rounded-lg bg-destructive/10 text-destructive p-4">
          <AlertCircle className="h-5 w-5 flex-shrink-0" />
          <div>
            <p className="font-semibold text-sm">Ticket not found</p>
            <p className="text-xs opacity-80">No ticket matches that check-in code.</p>
          </div>
        </div>
      )}

      {/* Scanned result */}
      {scannedTicket && <TicketScanResult ticket={scannedTicket} />}
    </div>
  )
}
