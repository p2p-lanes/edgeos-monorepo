import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { Info, Link2, Plus } from "lucide-react"
import { Suspense } from "react"

import { type InvitePublic, InvitesService, PopupsService } from "@/client"
import { CopyLinkButton } from "@/components/Common/CopyLinkButton"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { FlowNameCell } from "@/components/forms/FlowNameCell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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

function AddInviteButton({ disabled }: { disabled: boolean }) {
  if (disabled) {
    return (
      <Button disabled title="Enable invites in popup settings first">
        <Plus className="mr-2 h-4 w-4" />
        Add Invite
      </Button>
    )
  }
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

function FlowCell({ invite }: { invite: InvitePublic }) {
  const { selectedPopupId } = useWorkspace()
  return (
    <FlowNameCell popupId={selectedPopupId} flowId={invite.sales_flow_id} />
  )
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
    // Two invites can look identical and land people in different flows,
    // which decides the form they fill in and the emails they get.
    accessorKey: "sales_flow_id",
    header: "Sales flow",
    cell: ({ row }) => <FlowCell invite={row.original} />,
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

function InvitesTableContent({
  popupId,
  canAddInvites,
}: {
  popupId: string | null
  canAddInvites: boolean
}) {
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
          action={<AddInviteButton disabled={!canAddInvites} />}
        />
      }
    />
  )
}

function Invites() {
  const { isOperatorOrAbove } = useAuth()
  const { selectedPopupId, isContextReady } = useWorkspace()

  const { data: popup } = useQuery({
    queryKey: ["popups", selectedPopupId],
    queryFn: () => PopupsService.getPopup({ popupId: selectedPopupId ?? "" }),
    enabled: !!selectedPopupId,
  })
  const invitesEnabled = popup?.invites_enabled ?? false

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Invites</h1>
          <p className="text-muted-foreground">
            Manage invite links with discounts and approval rules
          </p>
        </div>
        {isOperatorOrAbove && isContextReady && (
          <AddInviteButton disabled={!invitesEnabled} />
        )}
      </div>
      {isContextReady && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Invites vs Groups</AlertTitle>
          <AlertDescription>
            Invites are individual links that grant a specific person a discount
            or an automatic approval. Groups gather multiple attendees under a
            shared link to manage team registrations and group discounts. Use
            invites for one-off offers and groups for teams.
          </AlertDescription>
        </Alert>
      )}
      {isContextReady && popup && !invitesEnabled && (
        <Alert>
          <AlertDescription>
            Invites are disabled for this popup. Enable them in the popup
            settings to create invite links.
          </AlertDescription>
        </Alert>
      )}
      {!isContextReady ? (
        <WorkspaceAlert resource="invites" />
      ) : (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <InvitesTableContent
              popupId={selectedPopupId}
              canAddInvites={invitesEnabled}
            />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
