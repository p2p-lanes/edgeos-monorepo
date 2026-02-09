import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import {
  Copy,
  Download,
  EllipsisVertical,
  Eye,
  QrCode,
  Users,
} from "lucide-react"
import { Suspense, useState } from "react"

import { type AttendeePublic, AttendeesService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
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
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard"
import useCustomToast from "@/hooks/useCustomToast"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { exportToCsv } from "@/lib/export"

function getAttendeesQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
) {
  return {
    queryFn: () =>
      AttendeesService.listAttendees({
        skip: page * pageSize,
        limit: pageSize,
        popupId: popupId || undefined,
      }),
    queryKey: ["attendees", popupId, { page, pageSize }],
  }
}

export const Route = createFileRoute("/_layout/attendees")({
  component: Attendees,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Attendees - EdgeOS" }],
  }),
})

function ViewAttendee({ attendee }: { attendee: AttendeePublic }) {
  const [isOpen, setIsOpen] = useState(false)
  const [, copy] = useCopyToClipboard()
  const { showSuccessToast } = useCustomToast()

  const copyToClipboard = (text: string, label: string) => {
    copy(text)
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
                aria-label="Copy check-in code"
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
                {attendee.products.map((product) => (
                  <Badge key={String(product)} variant="secondary">
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

function AttendeeActionsMenu({ attendee }: { attendee: AttendeePublic }) {
  const [open, setOpen] = useState(false)
  const [, copy] = useCopyToClipboard()
  const { showSuccessToast } = useCustomToast()

  const copyCheckInCode = () => {
    copy(attendee.check_in_code)
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
    header: ({ column }) => <SortableHeader label="Name" column={column} />,
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "email",
    header: ({ column }) => <SortableHeader label="Email" column={column} />,
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
  const searchParams = Route.useSearch()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/attendees",
  )

  const { data: attendees } = useSuspenseQuery(
    getAttendeesQueryOptions(
      selectedPopupId,
      pagination.pageIndex,
      pagination.pageSize,
    ),
  )

  const filtered = search
    ? attendees.results.filter((a) => {
        const term = search.toLowerCase()
        return (
          (a.name ?? "").toLowerCase().includes(term) ||
          (a.email ?? "").toLowerCase().includes(term) ||
          (a.check_in_code ?? "").toLowerCase().includes(term)
        )
      })
    : attendees.results

  return (
    <DataTable
      columns={columns}
      data={filtered}
      searchPlaceholder="Search by name, email, or check-in code..."
      hiddenOnMobile={["check_in_code", "gender", "category"]}
      searchValue={search}
      onSearchChange={setSearch}
      serverPagination={{
        total: search ? filtered.length : attendees.paging.total,
        pagination: search
          ? { pageIndex: 0, pageSize: attendees.paging.total }
          : pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        !search ? (
          <EmptyState
            icon={Users}
            title="No attendees yet"
            description="Attendees will appear here once applications are approved and check-ins begin."
          />
        ) : undefined
      }
    />
  )
}

function Attendees() {
  const { isContextReady } = useWorkspace()
  const { selectedPopupId } = useWorkspace()
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (!selectedPopupId) return
    setIsExporting(true)
    try {
      const data = await AttendeesService.listAttendees({
        skip: 0,
        limit: 10000,
        popupId: selectedPopupId,
      })
      exportToCsv(
        "attendees",
        data.results as unknown as Record<string, unknown>[],
        [
          { key: "name", label: "Name" },
          { key: "email", label: "Email" },
          { key: "category", label: "Category" },
          { key: "check_in_code", label: "Check-in Code" },
          { key: "gender", label: "Gender" },
        ],
      )
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Attendees</h1>
          <p className="text-muted-foreground">
            Manage event attendees and check-ins
          </p>
        </div>
        {isContextReady && (
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={isExporting}
          >
            <Download className="mr-2 h-4 w-4" />
            {isExporting ? "Exporting..." : "Export CSV"}
          </Button>
        )}
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
