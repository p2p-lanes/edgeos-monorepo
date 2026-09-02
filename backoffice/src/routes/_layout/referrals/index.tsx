import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { Info, Share2 } from "lucide-react"
import { Suspense } from "react"

import { type InvitePublic, InvitesService, PopupsService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"

function getReferralsQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
) {
  return {
    queryFn: () =>
      InvitesService.listInvites({
        popupId: popupId ?? undefined,
        // Attendee-created links only: admin invites have their own screen.
        issuer: "portal",
        skip: page * pageSize,
        limit: pageSize,
      }),
    queryKey: ["referrals", { popupId, page, pageSize }],
  }
}

export const Route = createFileRoute("/_layout/referrals/")({
  component: Referrals,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Referrals - EdgeOS" }],
  }),
})

const columns: ColumnDef<InvitePublic>[] = [
  {
    accessorKey: "token",
    header: ({ column }) => <SortableHeader label="Code" column={column} />,
    cell: ({ row }) => (
      <span className="inline-flex items-center gap-2">
        <span className="font-mono text-sm">{row.original.token}</span>
        {row.original.is_disabled && (
          <Badge variant="destructive">Disabled</Badge>
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
]

function ReferralsTableContent({ popupId }: { popupId: string | null }) {
  const navigate = useNavigate()
  const searchParams = Route.useSearch()
  const { pagination, setPagination } = useTableSearchParams(
    searchParams,
    "/referrals",
  )

  const { data: referrals } = useQuery({
    ...getReferralsQueryOptions(
      popupId,
      pagination.pageIndex,
      pagination.pageSize,
    ),
    placeholderData: keepPreviousData,
  })

  if (!referrals) return <Skeleton className="h-64 w-full" />

  return (
    <DataTable
      columns={columns}
      data={referrals.results}
      hiddenOnMobile={["current_uses", "expires_at"]}
      onRowClick={(referral) =>
        navigate({
          to: "/referrals/$referralId/edit",
          params: { referralId: referral.id },
        })
      }
      serverPagination={{
        total: referrals.paging.total,
        pagination: pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        <EmptyState
          icon={Share2}
          title="No referrals yet"
          description="Referral codes are created by attendees. They will appear here for moderation."
        />
      }
    />
  )
}

function Referrals() {
  const { selectedPopupId, isContextReady } = useWorkspace()

  const { data: popup } = useQuery({
    queryKey: ["popups", selectedPopupId],
    queryFn: () => PopupsService.getPopup({ popupId: selectedPopupId ?? "" }),
    enabled: !!selectedPopupId,
  })
  const referralsEnabled = popup?.referrals_enabled ?? false

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Referrals</h1>
          <p className="text-muted-foreground">
            Moderate attendee referral codes and adjust discount settings
          </p>
        </div>
      </div>
      {isContextReady && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertTitle>About referrals</AlertTitle>
          <AlertDescription>
            Referral codes are created by attendees in the portal to refer other
            people. Each code automatically approves the referred person and can
            carry a discount. Unlike invites, which admins create for specific
            recipients, referrals grow from your attendees. Here you can
            moderate them: disable codes or adjust their discount.
          </AlertDescription>
        </Alert>
      )}
      {isContextReady && popup && !referralsEnabled && (
        <Alert>
          <AlertDescription>
            Referrals are disabled for this popup. Attendees cannot create or
            redeem referral codes until you enable them in the popup settings.
          </AlertDescription>
        </Alert>
      )}
      {!isContextReady ? (
        <WorkspaceAlert resource="referrals" />
      ) : (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <ReferralsTableContent popupId={selectedPopupId} />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
