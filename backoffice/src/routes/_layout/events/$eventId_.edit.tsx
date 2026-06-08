import {
  useMutation,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { CalendarClock, Lock } from "lucide-react"
import { Suspense, useEffect, useState } from "react"

import { type EventPublic, EventsService, HumansService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { EventForm } from "@/components/forms/EventForm"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { useGoBack } from "@/hooks/useGoBack"

function AdminNotesCard({ eventId }: { eventId: string }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [value, setValue] = useState("")
  const [dirty, setDirty] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ["event-admin-notes", eventId],
    queryFn: () => EventsService.getEventAdminNotes({ eventId }),
  })

  // Seed the textarea from the server once (and on refetch) unless the user
  // has started editing, so we don't clobber in-progress typing.
  useEffect(() => {
    if (data && !dirty) setValue(data.notes ?? "")
  }, [data, dirty])

  const saveMutation = useMutation({
    mutationFn: () =>
      EventsService.updateEventAdminNotes({
        eventId,
        requestBody: { notes: value.trim() ? value : null },
      }),
    onSuccess: (res) => {
      setDirty(false)
      queryClient.setQueryData(["event-admin-notes", eventId], res)
      showSuccessToast("Notes saved")
    },
    onError: () => showErrorToast("Could not save notes"),
  })

  return (
    <div className="mx-auto max-w-2xl space-y-2 rounded-xl border bg-muted/30 p-4">
      <div className="flex items-center gap-2">
        <Lock className="h-3.5 w-3.5 text-muted-foreground" />
        <Label htmlFor="admin-notes" className="text-sm font-medium">
          Admin notes
        </Label>
        <span className="text-xs text-muted-foreground">
          Internal — visible only to staff
        </span>
      </div>
      <Textarea
        id="admin-notes"
        rows={4}
        value={value}
        disabled={isLoading}
        placeholder="Notes about this event, visible only to backoffice staff…"
        onChange={(e) => {
          setValue(e.target.value)
          setDirty(true)
        }}
      />
      <div className="flex justify-end">
        <Button
          size="sm"
          disabled={!dirty || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? "Saving…" : "Save notes"}
        </Button>
      </div>
    </div>
  )
}

function getInitials(
  firstName: string | null | undefined,
  lastName: string | null | undefined,
  email: string,
): string {
  const first = firstName?.trim()?.[0] ?? ""
  const last = lastName?.trim()?.[0] ?? ""
  const initials = `${first}${last}`.toUpperCase()
  if (initials) return initials
  return email.slice(0, 2).toUpperCase()
}

function formatCreatedAt(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  try {
    const d = new Date(dateStr)
    if (Number.isNaN(d.getTime())) return null
    return new Intl.DateTimeFormat("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(d)
  } catch {
    return null
  }
}

function CreatedByCard({ event }: { event: EventPublic }) {
  const { isAdmin } = useAuth()
  const { data: owner } = useQuery({
    queryKey: ["humans", event.owner_id],
    queryFn: () => HumansService.getHuman({ humanId: event.owner_id }),
    enabled: isAdmin && !!event.owner_id,
    staleTime: 60_000,
  })

  const createdAt = formatCreatedAt(event.created_at)
  const displayName =
    owner && (owner.first_name || owner.last_name)
      ? [owner.first_name, owner.last_name].filter(Boolean).join(" ")
      : owner?.email || "Unknown"

  return (
    <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 rounded-xl border bg-muted/30 px-4 py-3">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar className="size-10 border bg-background">
          {owner?.picture_url && (
            <AvatarImage src={owner.picture_url} alt={displayName} />
          )}
          <AvatarFallback className="text-xs font-medium">
            {owner
              ? getInitials(owner.first_name, owner.last_name, owner.email)
              : "?"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Created by
          </p>
          <p className="truncate text-sm font-medium leading-tight">
            {displayName}
          </p>
          {owner?.email && owner.email !== displayName && (
            <p className="truncate text-xs text-muted-foreground">
              {owner.email}
            </p>
          )}
        </div>
      </div>
      {createdAt && (
        <div className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
          <CalendarClock className="h-3.5 w-3.5" />
          <span>{createdAt}</span>
        </div>
      )}
    </div>
  )
}

export const Route = createFileRoute("/_layout/events/$eventId_/edit")({
  component: EditEventPage,
  head: () => ({
    meta: [{ title: "Edit Event - EdgeOS" }],
  }),
})

function EditEventContent({ eventId }: { eventId: string }) {
  const goBack = useGoBack({ to: "/events" })
  const { data: event } = useSuspenseQuery({
    queryKey: ["events", eventId],
    queryFn: () => EventsService.getEvent({ eventId }),
  })

  // Saved events always carry their own timezone; the form should respect
  // that as the source of truth (the calendar views render against it too).
  // Fallback to "UTC" is a defensive safety net for legacy/malformed rows.
  const popupTimezone = event.timezone || "UTC"

  return (
    <div className="space-y-4">
      <CreatedByCard event={event} />
      <EventForm
        defaultValues={event}
        popupTimezone={popupTimezone}
        onSuccess={goBack}
      />
      <AdminNotesCard eventId={eventId} />
    </div>
  )
}

function EditEventPage() {
  const { eventId } = Route.useParams()

  return (
    <FormPageLayout
      title="Edit Event"
      description="Update event details"
      backTo="/events"
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditEventContent eventId={eventId} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
