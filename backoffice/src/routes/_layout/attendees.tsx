import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { Copy, EllipsisVertical, Eye, QrCode } from "lucide-react"
import { Suspense, useState } from "react"

import { type AttendeePublic, AttendeesService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useCustomToast from "@/hooks/useCustomToast"

function getAttendeesQueryOptions(popupId: string | null) {
  return {
    queryFn: () =>
      AttendeesService.listAttendees({
        skip: 0,
        limit: 100,
        popupId: popupId || undefined,
      }),
    queryKey: ["attendees", popupId],
  }
}

export const Route = createFileRoute("/_layout/attendees")({
  component: Attendees,
  head: () => ({
    meta: [{ title: "Attendees - EdgeOS" }],
  }),
})

// View Attendee Dialog
function ViewAttendee({ attendee }: { attendee: AttendeePublic }) {
  const [isOpen, setIsOpen] = useState(false)
  const { showSuccessToast } = useCustomToast()

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text)
    showSuccessToast(`${label} copied to clipboard`)
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuItem
        onSelect={(e) => e.preventDefault()}
        onClick={() => setIsOpen(true)}
      >
        <Eye className="mr-2 h-4 w-4" />
        View Details
      </DropdownMenuItem>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Attendee Details</DialogTitle>
          <DialogDescription>{attendee.name}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Name</p>
              <p className="font-medium">{attendee.name}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Email</p>
              <p>{attendee.email || "N/A"}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Category
              </p>
              <Badge variant="outline">{attendee.category}</Badge>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                Gender
              </p>
              <p>{attendee.gender || "N/A"}</p>
            </div>
          </div>

          <div className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  Check-in Code
                </p>
                <p className="font-mono text-lg font-bold">
                  {attendee.check_in_code}
                </p>
              </div>
              <Button
                variant="outline"
                size="icon"
                onClick={() =>
                  copyToClipboard(attendee.check_in_code, "Check-in code")
                }
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {attendee.poap_url && (
            <div>
              <p className="text-sm font-medium text-muted-foreground">
                POAP URL
              </p>
              <a
                href={attendee.poap_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline break-all"
              >
                {attendee.poap_url}
              </a>
            </div>
          )}

          {attendee.products && attendee.products.length > 0 && (
            <div>
              <p className="text-sm font-medium text-muted-foreground mb-2">
                Products
              </p>
              <div className="flex flex-wrap gap-2">
                {attendee.products.map((product, idx) => (
                  <Badge key={idx} variant="secondary">
                    {String(product)}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm text-muted-foreground">
            {attendee.created_at && (
              <div>
                Created: {new Date(attendee.created_at).toLocaleString()}
              </div>
            )}
            {attendee.updated_at && (
              <div>
                Updated: {new Date(attendee.updated_at).toLocaleString()}
              </div>
            )}
          </div>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Close</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Actions Menu
function AttendeeActionsMenu({ attendee }: { attendee: AttendeePublic }) {
  const [open, setOpen] = useState(false)
  const { showSuccessToast } = useCustomToast()

  const copyCheckInCode = () => {
    navigator.clipboard.writeText(attendee.check_in_code)
    showSuccessToast("Check-in code copied")
    setOpen(false)
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Attendee actions">
          <EllipsisVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ViewAttendee attendee={attendee} />
        <DropdownMenuItem onClick={copyCheckInCode}>
          <QrCode className="mr-2 h-4 w-4" />
          Copy Check-in Code
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const columns: ColumnDef<AttendeePublic>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "email",
    header: "Email",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.email || "N/A"}
      </span>
    ),
  },
  {
    accessorKey: "category",
    header: "Category",
    cell: ({ row }) => <Badge variant="outline">{row.original.category}</Badge>,
  },
  {
    accessorKey: "check_in_code",
    header: "Check-in Code",
    cell: ({ row }) => (
      <span className="font-mono text-sm">{row.original.check_in_code}</span>
    ),
  },
  {
    accessorKey: "gender",
    header: "Gender",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.gender || "N/A"}
      </span>
    ),
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <AttendeeActionsMenu attendee={row.original} />
      </div>
    ),
  },
]

function AttendeesTableContent() {
  const { selectedPopupId } = useWorkspace()
  const { data: attendees } = useSuspenseQuery(
    getAttendeesQueryOptions(selectedPopupId),
  )
  return <DataTable columns={columns} data={attendees.results} />
}

function Attendees() {
  const { isContextReady } = useWorkspace()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Attendees</h1>
          <p className="text-muted-foreground">
            Manage event attendees and check-ins
          </p>
        </div>
      </div>
      {!isContextReady ? (
        <WorkspaceAlert resource="attendees" />
      ) : (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <AttendeesTableContent />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
