import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { useEffect, useState } from "react"

import { type ApiError, AttendeesService } from "@/client"
import { AttendeeActivity } from "@/components/Attendees/AttendeeActivity"
import { ManageAttendeeProducts } from "@/components/Attendees/ManageAttendeeProducts"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

export const Route = createFileRoute("/_layout/attendees/$attendeeId")({
  component: AttendeeEditPage,
  head: () => ({
    meta: [{ title: "Attendee - EdgeOS" }],
  }),
})

function AttendeeEditPage() {
  const { attendeeId } = Route.useParams()
  return (
    <QueryErrorBoundary>
      <AttendeeEditContent attendeeId={attendeeId} />
    </QueryErrorBoundary>
  )
}

function AttendeeEditContent({ attendeeId }: { attendeeId: string }) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const { data: attendee } = useQuery({
    queryKey: ["attendees", attendeeId],
    queryFn: () => AttendeesService.getAttendee({ attendeeId }),
  })

  const [form, setForm] = useState({ name: "", email: "", gender: "" })
  const [dirty, setDirty] = useState(false)

  // Seed the form from the server once (and on refetch) unless the user has
  // started editing, so a background refresh does not clobber in-progress edits.
  useEffect(() => {
    if (attendee && !dirty) {
      setForm({
        name: attendee.name ?? "",
        email: attendee.email ?? "",
        gender: attendee.gender ?? "",
      })
    }
  }, [attendee, dirty])

  const saveMutation = useMutation({
    mutationFn: () =>
      AttendeesService.updateAttendee({
        attendeeId,
        requestBody: {
          name: form.name,
          email: form.email || null,
          gender: form.gender || null,
        },
      }),
    onSuccess: (updated) => {
      setDirty(false)
      queryClient.setQueryData(["attendees", attendeeId], updated)
      queryClient.invalidateQueries({ queryKey: ["attendees"] })
      showSuccessToast("Attendee updated")
    },
    onError: (err: ApiError) => createErrorHandler(showErrorToast)(err),
  })

  if (!attendee) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  return (
    <FormPageLayout
      title={attendee.name}
      description="Edit attendee details, tickets and activity"
      backTo="/attendees"
    >
      <div className="mx-auto w-full max-w-2xl space-y-6">
        {/* Details */}
        <div className="space-y-4 rounded-xl border p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Details</h2>
            <Badge variant="secondary" className="capitalize">
              {attendee.category}
            </Badge>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="att-name">Name</Label>
            <Input
              id="att-name"
              value={form.name}
              onChange={(e) => {
                setDirty(true)
                setForm((f) => ({ ...f, name: e.target.value }))
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="att-email">Email</Label>
            <Input
              id="att-email"
              type="email"
              value={form.email}
              onChange={(e) => {
                setDirty(true)
                setForm((f) => ({ ...f, email: e.target.value }))
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="att-gender">Gender</Label>
            <Input
              id="att-gender"
              value={form.gender}
              onChange={(e) => {
                setDirty(true)
                setForm((f) => ({ ...f, gender: e.target.value }))
              }}
            />
          </div>
          <div className="flex justify-end">
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!dirty || !form.name.trim() || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </div>

        {/* Tickets — change / remove / add products for this attendee */}
        <div className="rounded-xl border">
          <ManageAttendeeProducts attendee={attendee} />
        </div>

        {/* Activity — audited history for this attendee */}
        <div className="rounded-xl border">
          <AttendeeActivity attendeeId={attendee.id} />
        </div>
      </div>
    </FormPageLayout>
  )
}
