import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { Link2, Plus } from "lucide-react"
import { Suspense } from "react"

import { type InvitePublic, InvitesService } from "@/client"
import { CopyLinkButton } from "@/components/Common/CopyLinkButton"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import { useCurrentTenant } from "@/hooks/useCurrentTenant"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { getInvitePortalUrl, getPortalBaseUrl } from "@/lib/portal-urls"

function getInvitesQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
) {
  return {
    queryFn: () =>
      InvitesService.listInvites({
        popupId: popupId ?? undefined,
        skip: page * pageSize,
        limit: pageSize,
      }),
    queryKey: ["invites", { popupId, page, pageSize }],
  }
}

export const Route = createFileRoute("/_layout/invites/")({
  component: Invites,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Invites - EdgeOS" }],
  }),
})

function AddInviteButton() {
  return (
    <Button asChild>
      <Link to="/invites/new">
        <Plus className="mr-2 h-4 w-4" />
        Add Invite
      </Link>
    </Button>
  )
}

function InviteCopyLink({ invite }: { invite: InvitePublic }) {
  const { data: tenant } = useCurrentTenant()
  const baseUrl = getPortalBaseUrl(tenant)
  const url =
    baseUrl && invite.token ? getInvitePortalUrl(baseUrl, invite.token) : null
  return <CopyLinkButton url={url} iconOnly />
}

const columns: ColumnDef<InvitePublic>[] = [
  {
    accessorKey: "token",
    header: ({ column }) => <SortableHeader label="Token" column={column} />,
    cell: ({ row }) => (
      <span className="font-mono text-sm">{row.original.token}</span>
    ),
  },
  {
    accessorKey: "recipient_email",
    header: "Recipient",
    cell: ({ row }) => (
      <span className="text-sm">
        {row.original.recipient_email ?? (
          <span className="text-muted-foreground">Open</span>
        )}
      </span>
    ),
  },
  {
    accessorKey: "discount_percentage",
    header: ({ column }) => <SortableHeader label="Discount" column={column} />,
    cell: ({ row }) => <span>{row.original.discount_percentage}%</span>,
  },
  {
    accessorKey: "current_uses",
    header: "Uses",
    cell: ({ row }) => (
      <span>
        {row.original.current_uses}
        {row.original.max_uses != null ? ` / ${row.original.max_uses}` : ""}
      </span>
    ),
  },
  {
    accessorKey: "expires_at",
    header: "Expires",
    cell: ({ row }) =>
      row.original.expires_at ? (
        <span className="text-sm">
          {new Date(row.original.expires_at).toLocaleDateString()}
        </span>
      ) : (
        <span className="text-muted-foreground text-sm">Never</span>
      ),
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <InviteCopyLink invite={row.original} />
      </div>
    ),
  },
]

function InvitesTableContent({ popupId }: { popupId: string | null }) {
  const navigate = useNavigate()
  const searchParams = Route.useSearch()
  const { pagination, setPagination } = useTableSearchParams(
    searchParams,
    "/invites",
  )

  const { data: invites } = useQuery({
    ...getInvitesQueryOptions(
      popupId,
      pagination.pageIndex,
      pagination.pageSize,
    ),
    placeholderData: keepPreviousData,
  })

  if (!invites) return <Skeleton className="h-64 w-full" />

  return (
    <DataTable
      columns={columns}
      data={invites.results}
      hiddenOnMobile={["current_uses", "expires_at"]}
      onRowClick={(invite) =>
        navigate({
          to: "/invites/$inviteId/edit",
          params: { inviteId: invite.id },
        })
      }
      serverPagination={{
        total: invites.paging.total,
        pagination: pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        <EmptyState
          icon={Link2}
          title="No invites yet"
          description="Create invite links to offer discounts or automatic approvals to specific attendees."
          action={
            <Button asChild>
              <Link to="/invites/new">
                <Plus className="mr-2 h-4 w-4" />
                Add Invite
              </Link>
            </Button>
          }
        />
      }
    />
  )
}

function Invites() {
  const { isOperatorOrAbove } = useAuth()
  const { selectedPopupId, isContextReady } = useWorkspace()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invites</h1>
          <p className="text-muted-foreground">
            Manage invite links with discounts and approval rules
          </p>
        </div>
        {isOperatorOrAbove && isContextReady && <AddInviteButton />}
      </div>
      {!isContextReady ? (
        <WorkspaceAlert resource="invites" />
      ) : (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <InvitesTableContent popupId={selectedPopupId} />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
