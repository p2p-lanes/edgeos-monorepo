"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { CheckCircle2, CircleAlert, Ticket } from "lucide-react"
import Link from "next/link"
import { notFound, useParams } from "next/navigation"
import { useEffect, useState } from "react"
import {
  ApiError,
  CheckInService,
  type SelfCheckInResult,
  type SelfCheckInTicket,
} from "@/client"
import { Button } from "@/components/ui/button"
import { Loader } from "@/components/ui/Loader"
import { cn } from "@/lib/utils"

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value))
}

function formatDuration(value: string | null | undefined) {
  if (!value) return null
  return value.replaceAll("_", " ")
}

function TicketCard({
  ticket,
  selected,
  onSelect,
}: {
  ticket: SelfCheckInTicket
  selected: boolean
  onSelect: () => void
}) {
  const disabled = ticket.checked_in
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      className={cn(
        "w-full rounded-2xl border bg-card p-4 text-left shadow-sm transition",
        selected && !disabled && "border-primary ring-2 ring-primary/20",
        disabled && "cursor-not-allowed bg-muted/60 text-muted-foreground",
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-1 rounded-full bg-primary/10 p-2 text-primary">
          <Ticket className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold">{ticket.attendee_name}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {ticket.product_name}
            {ticket.product_category ? ` · ${ticket.product_category}` : ""}
            {formatDuration(ticket.duration_type)
              ? ` · ${formatDuration(ticket.duration_type)}`
              : ""}
          </div>
          <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
            {ticket.attendee_category}
          </div>
          {ticket.first_check_in_at && (
            <div className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm">
              Already checked in on {formatDate(ticket.first_check_in_at)}
            </div>
          )}
        </div>
      </div>
    </button>
  )
}

function SuccessView({ ticket }: { ticket: SelfCheckInResult }) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-5 py-10">
      <div className="rounded-3xl border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100 text-green-700">
          <CheckCircle2 className="h-8 w-8" />
        </div>
        <h1 className="mt-5 text-2xl font-bold">You're checked in</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Checked in on {formatDate(ticket.checked_in_at)}
        </p>
        <div className="mt-6 rounded-2xl bg-muted p-4 text-left">
          <div className="font-semibold">{ticket.attendee_name}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            {ticket.product_name}
            {ticket.product_category ? ` · ${ticket.product_category}` : ""}
            {formatDuration(ticket.duration_type)
              ? ` · ${formatDuration(ticket.duration_type)}`
              : ""}
          </div>
          <div className="mt-1 text-xs uppercase tracking-wide text-muted-foreground">
            {ticket.attendee_category}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function SelfCheckInPage() {
  const params = useParams<{ popupSlug: string }>()
  const popupSlug = params.popupSlug
  const queryClient = useQueryClient()
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null)
  const [checkedInTicket, setCheckedInTicket] =
    useState<SelfCheckInResult | null>(null)

  const optionsQuery = useQuery({
    queryKey: ["self-check-in-options", popupSlug],
    queryFn: () => CheckInService.getMyCheckInOptions({ popupSlug }),
  })

  useEffect(() => {
    if (optionsQuery.data?.tickets.length === 1) {
      setSelectedTicketId(optionsQuery.data.tickets[0].attendee_product_id)
    }
  }, [optionsQuery.data])

  const mutation = useMutation({
    mutationFn: (attendeeProductId: string) =>
      CheckInService.confirmMyCheckIn({
        popupSlug,
        requestBody: { attendee_product_id: attendeeProductId },
      }),
    onSuccess: (result) => {
      setCheckedInTicket(result)
      queryClient.invalidateQueries({
        queryKey: ["self-check-in-options", popupSlug],
      })
    },
  })

  if (
    optionsQuery.error instanceof ApiError &&
    optionsQuery.error.status === 404
  ) {
    notFound()
  }

  if (checkedInTicket) return <SuccessView ticket={checkedInTicket} />

  if (optionsQuery.isLoading || !optionsQuery.data) {
    return <Loader />
  }

  const { popup, tickets } = optionsQuery.data
  const selectedTicket = tickets.find(
    (ticket) => ticket.attendee_product_id === selectedTicketId,
  )
  const canSubmit = !!selectedTicket && !selectedTicket.checked_in

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-5 py-8">
      <div className="mb-6">
        <p className="text-sm font-medium text-muted-foreground">
          {popup.name}
        </p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">Check in</h1>
      </div>

      {tickets.length === 0 ? (
        <div className="rounded-3xl border bg-card p-6 shadow-sm">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <CircleAlert className="h-6 w-6 text-muted-foreground" />
          </div>
          <p className="mt-5 text-lg font-semibold">
            You don't have any tickets for {popup.name}, buy your tickets here
          </p>
          <Button asChild className="mt-6 w-full">
            <Link href={`/portal/${popupSlug}/passes/buy`}>Buy tickets</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {tickets.map((ticket) => (
            <TicketCard
              key={ticket.attendee_product_id}
              ticket={ticket}
              selected={ticket.attendee_product_id === selectedTicketId}
              onSelect={() => setSelectedTicketId(ticket.attendee_product_id)}
            />
          ))}

          {mutation.error instanceof ApiError && (
            <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {mutation.error.status === 409
                ? "This ticket is already checked in."
                : "Unable to check in. Please try again."}
            </div>
          )}

          <Button
            className="h-12 w-full rounded-xl text-base"
            disabled={!canSubmit || mutation.isPending}
            onClick={() =>
              selectedTicketId && mutation.mutate(selectedTicketId)
            }
          >
            {mutation.isPending ? "Checking in..." : "Confirm check-in"}
          </Button>
        </div>
      )}
    </div>
  )
}
