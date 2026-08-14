import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { Info, Link2, Plus } from "lucide-react"
import { Suspense, useState } from "react"

import { type InvitePublic, InvitesService } from "@/client"
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

/** Who made the link. The backend has answered for both since referrals
 *  stopped being their own table — an attendee's link is an invite that
 *  carries a referrer instead of a creator. */
type Issuer = "all" | "admin" | "portal"

const ISSUERS: { value: Issuer; label: string }[] = [
  { value: "all", label: "All links" },
  { value: "admin", label: "Made by the team" },
  { value: "portal", label: "Shared by attendees" },
]

function getInvitesQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
  issuer: Issuer,
) {
  return {
    queryFn: () =>
      InvitesService.listInvites({
        popupId: popupId ?? undefined,
        issuer,
        skip: page * pageSize,
        limit: pageSize,
      }),
    queryKey: ["invites", { popupId, page, pageSize, issuer }],
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
    // The one thing that used to justify a second screen for the same table.
    accessorKey: "referrer_human_id",
    header: "Issued by",
    cell: ({ row }) => (
      <span className="text-sm">
        {row.original.referrer_human_id ? "Attendee" : "Team"}
      </span>
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

  const [issuer, setIssuer] = useState<Issuer>("all")

  const { data: invites } = useQuery({
    ...getInvitesQueryOptions(
      popupId,
      pagination.pageIndex,
      pagination.pageSize,
      issuer,
    ),
    placeholderData: keepPreviousData,
  })

  if (!invites) return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {ISSUERS.map((option) => (
          <Button
            key={option.value}
            type="button"
            size="sm"
            variant={issuer === option.value ? "default" : "outline"}
            onClick={() => setIssuer(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
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
            title="No links yet"
            description="Create a link to offer a discount or an automatic approval, or let attendees share their own from the portal."
            action={<AddInviteButton />}
          />
        }
      />
    </div>
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
      {isContextReady && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>Links into this event</AlertTitle>
          <AlertDescription>
            One link, whoever made it: your team creates them here, attendees
            share their own from the portal. Each one names the way in it opens,
            and that way in decides whether it may be created at all — look in
            the sales flow, not here. Groups are the other thing: a shared link
            for a whole team rather than one person.
          </AlertDescription>
        </Alert>
      )}
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
