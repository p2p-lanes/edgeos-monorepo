import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import {
  Download,
  EllipsisVertical,
  Eye,
  Gift,
  Mail,
  QrCode,
  User,
  Users,
} from "lucide-react"
import { Suspense, useState } from "react"

import {
  type AttendeeListItem,
  AttendeesService,
  type AttendeeWithOriginPublic,
} from "@/client"
import { ProductsCell } from "@/components/Attendees/ProductsCell"
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { InlineRow, InlineSection } from "@/components/ui/inline-form"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { exportToCsv, fetchAllPages } from "@/lib/export"

// ── CSV flattening helper ─────────────────────────────────────────────────────

type FlatAttendeeRow = {
  name: string
  email: string | null | undefined
  category: string
  gender: string | null | undefined
  product_id: string
}

/**
 * Expand each attendee into one row per purchased ticket.
 * Attendees with no products emit a single row with an empty product_id so
 * they still appear in the CSV. Per-ticket check_in_codes are not exported
 * here — the list endpoint does not carry them; staff can read them from
 * the attendee detail dialog.
 */
export function flattenAttendeesForCsv(
  attendees: AttendeeListItem[],
): FlatAttendeeRow[] {
  return attendees.flatMap((att) => {
    const products = att.products ?? []
    if (products.length === 0) {
      return [
        {
          name: att.name,
          email: att.email,
          category: att.category ?? "",
          gender: att.gender,
          product_id: "",
        },
      ]
    }
    return products.map((p) => ({
      name: att.name,
      email: att.email,
      category: att.category ?? "",
      gender: att.gender,
      product_id: String(p.id),
    }))
  })
}

function getAttendeesQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
  search?: string,
) {
  return {
    queryFn: () =>
      AttendeesService.listAttendees({
        skip: page * pageSize,
        limit: pageSize,
        popupId: popupId || undefined,
        search: search || undefined,
      }),
    queryKey: ["attendees", popupId, { page, pageSize, search }],
  }
}

export const Route = createFileRoute("/_layout/attendees")({
  component: Attendees,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Attendees - EdgeOS" }],
  }),
})

/**
 * Renders the inner content of the attendee details dialog.
 * Exported for unit-test isolation — rendered without Dialog wrapper so callers
 * can assert on the content without needing modal open/close machinery.
 *
 * Accepts AttendeeWithOriginPublic so products[] is typed as
 * AttendeeProductPublic[] and check_in_code is always populated.
 */
export function AttendeeDetailsContent({
  attendee,
}: {
  attendee: AttendeeWithOriginPublic
}) {
  const products = attendee.products ?? []

  return (
    <>
      {/* Hero */}
      <div className="space-y-1 px-6 pt-6 pb-4">
        <p className="text-2xl font-semibold">{attendee.name}</p>
        <Badge variant="secondary" className="capitalize">
          {attendee.category}
        </Badge>
      </div>

      <Separator />

      {/* Contact */}
      <InlineSection title="Contact" className="px-6 py-4">
        <InlineRow
          icon={<Mail className="h-4 w-4 text-muted-foreground" />}
          label="Email"
        >
          <span className="text-sm text-muted-foreground">
            {attendee.email || "N/A"}
          </span>
        </InlineRow>
        {attendee.gender && (
          <InlineRow
            icon={<User className="h-4 w-4 text-muted-foreground" />}
            label="Gender"
          >
            <span className="text-sm text-muted-foreground">
              {attendee.gender}
            </span>
          </InlineRow>
        )}
      </InlineSection>

      {/* Check-in — only render when the attendee actually purchased tickets.
          Codes belong to purchased products, not to attendees. */}
      {products.length > 0 && (
        <>
          <Separator />
          <InlineSection title="Check-in" className="px-6 py-4">
            {products.map((p) => (
              <InlineRow
                key={p.id}
                icon={<QrCode className="h-4 w-4 text-muted-foreground" />}
                label="Ticket code"
              >
                <span className="font-mono text-sm font-medium">
                  {p.check_in_code}
                </span>
              </InlineRow>
            ))}
          </InlineSection>
        </>
      )}

      {/* Footer */}
      <Separator />
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex gap-4 text-xs text-muted-foreground">
          {attendee.created_at && (
            <span>{new Date(attendee.created_at).toLocaleDateString()}</span>
          )}
          {attendee.updated_at && (
            <span>
              Updated {new Date(attendee.updated_at).toLocaleDateString()}
            </span>
          )}
        </div>
        <DialogClose asChild>
          <Button variant="outline" size="sm">
            Close
          </Button>
        </DialogClose>
      </div>
    </>
  )
}

function ViewAttendee({ attendee }: { attendee: AttendeeListItem }) {
  const [isOpen, setIsOpen] = useState(false)

  // Fetch full detail (AttendeeWithOriginPublic with typed products[]) only
  // when the dialog is open so check_in_code is populated per ticket.
  const { data: detail } = useQuery({
    queryKey: ["attendees", attendee.id],
    queryFn: () => AttendeesService.getAttendee({ attendeeId: attendee.id }),
    enabled: isOpen,
    staleTime: 30_000,
  })

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuItem
        onSelect={(e) => e.preventDefault()}
        onClick={() => setIsOpen(true)}
      >
        <Eye className="mr-2 h-4 w-4" />
        View Details
      </DropdownMenuItem>
      <DialogContent className="max-w-md gap-0 p-0">
        <DialogHeader className="sr-only">
          <DialogTitle>Attendee Details</DialogTitle>
          <DialogDescription>{attendee.name}</DialogDescription>
        </DialogHeader>
        {detail ? (
          <AttendeeDetailsContent attendee={detail} />
        ) : (
          <div className="px-6 py-8">
            <Skeleton className="h-32 w-full" />
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function AttendeeActionsMenu({ attendee }: { attendee: AttendeeListItem }) {
  const [open, setOpen] = useState(false)

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Attendee actions">
          <EllipsisVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <ViewAttendee attendee={attendee} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const columns: ColumnDef<AttendeeListItem>[] = [
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
    id: "products",
    header: "Tickets",
    meta: { label: "Tickets" },
    cell: ({ row }) => <ProductsCell products={row.original.products} />,
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

  const { data: attendees } = useQuery({
    ...getAttendeesQueryOptions(
      selectedPopupId,
      pagination.pageIndex,
      pagination.pageSize,
      search,
    ),
    placeholderData: keepPreviousData,
  })

  if (!attendees) return <Skeleton className="h-64 w-full" />

  return (
    <DataTable
      columns={columns}
      data={attendees.results}
      searchPlaceholder="Search by name or email..."
      hiddenOnMobile={["gender", "category"]}
      searchValue={search}
      onSearchChange={setSearch}
      serverPagination={{
        total: attendees.paging.total,
        pagination,
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
  const { isOperatorOrAbove } = useAuth()
  const [isExporting, setIsExporting] = useState(false)

  const handleExport = async () => {
    if (!selectedPopupId) return
    setIsExporting(true)
    try {
      const results = await fetchAllPages((skip, limit) =>
        AttendeesService.listAttendees({
          skip,
          limit,
          popupId: selectedPopupId,
        }),
      )
      const rows = flattenAttendeesForCsv(results as AttendeeListItem[])
      exportToCsv("attendees", rows as unknown as Record<string, unknown>[], [
        { key: "name", label: "Name" },
        { key: "email", label: "Email" },
        { key: "category", label: "Category" },
        { key: "gender", label: "Gender" },
        { key: "product_id", label: "Product ID" },
      ])
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
          <div className="flex items-center gap-2">
            {isOperatorOrAbove && selectedPopupId && (
              <Button asChild>
                <Link
                  to="/popups/$id/bulk-grant"
                  params={{ id: selectedPopupId }}
                >
                  <Gift className="mr-2 h-4 w-4" />
                  Invite
                </Link>
              </Button>
            )}
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={isExporting}
            >
              <Download className="mr-2 h-4 w-4" />
              {isExporting ? "Exporting..." : "Export CSV"}
            </Button>
          </div>
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
