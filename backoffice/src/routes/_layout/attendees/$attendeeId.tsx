import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { ClipboardList, Pencil, User } from "lucide-react"
import { useEffect, useState } from "react"

import { type ApiError, AttendeesService } from "@/client"
import { AttendeeActivity } from "@/components/Attendees/AttendeeActivity"
import { ManageAttendeeProducts } from "@/components/Attendees/ManageAttendeeProducts"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import useCustomToast from "@/hooks/useCustomToast"
import { readAgeGroup } from "@/lib/age-group"
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
  const [editOpen, setEditOpen] = useState(false)

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

  // Age group (baby/kid/teen) is collected in the portal and stored in
  // additional_data; it is shown read-only here (not editable from the BO).
  const ageGroup = readAgeGroup(attendee)

  const closeEdit = () => {
    // Resetting dirty re-seeds the form from the server (via the effect),
    // discarding any unsaved edits.
    setDirty(false)
    setEditOpen(false)
  }

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
      setEditOpen(false)
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
      description={attendee.email || "Attendee"}
      backTo="/attendees"
      actions={
        <>
          <Badge variant="secondary" className="capitalize">
            {attendee.category}
          </Badge>
          {attendee.human_id && (
            <Button variant="ghost" size="sm" asChild>
              <Link to="/humans/$id" params={{ id: attendee.human_id }}>
                <User className="mr-2 h-4 w-4" />
                View human
              </Link>
            </Button>
          )}
          {attendee.application_id && (
            <Button variant="ghost" size="sm" asChild>
              <Link
                to="/applications/$id"
                params={{ id: attendee.application_id }}
              >
                <ClipboardList className="mr-2 h-4 w-4" />
                View application
              </Link>
            </Button>
          )}
          <Button variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="mr-2 h-4 w-4" />
            Edit details
          </Button>
        </>
      }
    >
      <div className="mx-auto w-full max-w-3xl space-y-6">
        {/* Tickets — the reason this page exists: assign, swap and remove
            this attendee's products. */}
        <div className="rounded-xl border">
          <ManageAttendeeProducts attendee={attendee} />
        </div>

        {/* Activity — audited history for this attendee. */}
        <div className="rounded-xl border">
          <AttendeeActivity attendeeId={attendee.id} />
        </div>
      </div>

      <Dialog
        open={editOpen}
        onOpenChange={(open) => (open ? setEditOpen(true) : closeEdit())}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit details</DialogTitle>
            <DialogDescription>
              Update this attendee's name, email and gender.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
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
            {ageGroup && (
              <div className="space-y-1.5">
                <Label>Age group</Label>
                <p className="text-sm capitalize text-muted-foreground">
                  {ageGroup}
                </p>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeEdit}>
              Cancel
            </Button>
            <Button
              onClick={() => saveMutation.mutate()}
              disabled={!dirty || !form.name.trim() || saveMutation.isPending}
            >
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </FormPageLayout>
  )
}
