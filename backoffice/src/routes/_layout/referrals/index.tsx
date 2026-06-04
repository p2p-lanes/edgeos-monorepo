import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { Share2 } from "lucide-react"
import { Suspense } from "react"

import { type ReferralPublic, ReferralsService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
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
      ReferralsService.listReferralsAdmin({
        popupId: popupId ?? undefined,
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

const columns: ColumnDef<ReferralPublic>[] = [
  {
    accessorKey: "code",
    header: ({ column }) => <SortableHeader label="Code" column={column} />,
    cell: ({ row }) => (
      <span className="font-mono text-sm">{row.original.code}</span>
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
    accessorKey: "auto_approve",
    header: "Auto Approve",
    cell: ({ row }) => <span>{row.original.auto_approve ? "Yes" : "No"}</span>,
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
