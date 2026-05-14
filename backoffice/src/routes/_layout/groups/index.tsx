import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { EllipsisVertical, ExternalLink, Plus, Users } from "lucide-react"
import { Suspense, useState } from "react"

import { type GroupPublic, GroupsService } from "@/client"
import { DataTable, SortableHeader } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { StatusBadge } from "@/components/Common/StatusBadge"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
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
import useAuth from "@/hooks/useAuth"
import { useCurrentTenant } from "@/hooks/useCurrentTenant"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"
import { getGroupPortalUrl, getPortalBaseUrl } from "@/lib/portal-urls"

function getGroupsQueryOptions(
  popupId: string | null,
  page: number,
  pageSize: number,
  search?: string,
) {
  return {
    queryFn: () =>
      GroupsService.listGroups({
        popupId: popupId ?? undefined,
        skip: page * pageSize,
        limit: pageSize,
        search: search || undefined,
      }),
    queryKey: ["groups", { popupId, page, pageSize, search }],
  }
}

export const Route = createFileRoute("/_layout/groups/")({
  component: Groups,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [{ title: "Groups - EdgeOS" }],
  }),
})

function AddGroupButton() {
  return (
    <Button asChild>
      <Link to="/groups/new">
        <Plus className="mr-2 h-4 w-4" />
        Add Group
      </Link>
    </Button>
  )
}

function GroupMembersDialog({
  group,
  open,
  onOpenChange,
}: {
  group: GroupPublic
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const {
    data: groupWithMembers,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["groups", group.id],
    queryFn: () => GroupsService.getGroup({ groupId: group.id }),
    enabled: open,
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Group Members: {group.name}</DialogTitle>
          <DialogDescription>Members of this group</DialogDescription>
        </DialogHeader>
        <div className="py-4 max-h-[50vh] overflow-y-auto">
          {isLoading ? (
            <Skeleton className="h-32 w-full" />
          ) : isError ? (
            <p className="text-center text-destructive">
              Failed to load members
            </p>
          ) : groupWithMembers?.members &&
            groupWithMembers.members.length > 0 ? (
            <div className="space-y-2">
              {groupWithMembers.members.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div>
                    <p className="font-medium">
                      {member.first_name} {member.last_name}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {member.email}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground">No members yet</p>
          )}
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

function GroupActionsMenu({ group }: { group: GroupPublic }) {
  const [open, setOpen] = useState(false)
  const [membersOpen, setMembersOpen] = useState(false)
  const { data: tenant } = useCurrentTenant()
  const baseUrl = getPortalBaseUrl(tenant)
  const hasPortalLink = baseUrl && group.slug

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Group actions">
            <EllipsisVertical className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            onSelect={(e) => e.preventDefault()}
            onClick={() => {
              setOpen(false)
              setMembersOpen(true)
            }}
          >
            <Users className="mr-2 h-4 w-4" />
            View Members
          </DropdownMenuItem>
          {hasPortalLink && (
            <DropdownMenuItem asChild>
              <a
                href={getGroupPortalUrl(baseUrl, group.slug)}
                target="_blank"
                rel="noopener noreferrer"
              >
                <ExternalLink className="mr-2 h-4 w-4" />
                Open Portal
              </a>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <GroupMembersDialog
        group={group}
        open={membersOpen}
        onOpenChange={setMembersOpen}
      />
    </>
  )
}

const columns: ColumnDef<GroupPublic>[] = [
  {
    accessorKey: "name",
    header: ({ column }) => <SortableHeader label="Name" column={column} />,
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  {
    accessorKey: "discount_percentage",
    header: ({ column }) => <SortableHeader label="Discount" column={column} />,
    cell: ({ row }) => <span>{row.original.discount_percentage}%</span>,
  },
  {
    accessorKey: "max_members",
    header: "Max Members",
    cell: ({ row }) => <span>{row.original.max_members ?? "Unlimited"}</span>,
  },
  {
    accessorKey: "is_ambassador_group",
    header: "Type",
    cell: ({ row }) => (
      <StatusBadge
        status={row.original.is_ambassador_group ? "ambassador" : "regular"}
      />
    ),
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <GroupActionsMenu group={row.original} />
      </div>
    ),
  },
]

function GroupsTableContent() {
  const navigate = useNavigate()
  const { selectedPopupId } = useWorkspace()
  const searchParams = Route.useSearch()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/groups",
  )

  const { data: groups } = useQuery({
    ...getGroupsQueryOptions(
      selectedPopupId,
      pagination.pageIndex,
      pagination.pageSize,
      search,
    ),
    placeholderData: keepPreviousData,
  })

  if (!groups) return <Skeleton className="h-64 w-full" />

  return (
    <DataTable
      columns={columns}
      data={groups.results}
      searchPlaceholder="Search by name..."
      hiddenOnMobile={["max_members", "is_ambassador_group"]}
      searchValue={search}
      onSearchChange={setSearch}
      onRowClick={(group) =>
        navigate({ to: "/groups/$id/edit", params: { id: group.id } })
      }
      serverPagination={{
        total: groups.paging.total,
        pagination: pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        !search ? (
          <EmptyState
            icon={Users}
            title="No groups yet"
            description="Create groups to manage team registrations and offer group discounts."
            action={
              <Button asChild>
                <Link to="/groups/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Add Group
                </Link>
              </Button>
            }
          />
        ) : undefined
      }
    />
  )
}

function Groups() {
  const { isOperatorOrAbove } = useAuth()
  const { isContextReady } = useWorkspace()

  return (
    <div className="flex flex-col gap-6">
      {!isContextReady && <WorkspaceAlert resource="groups" />}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Groups</h1>
          <p className="text-muted-foreground">
            Manage group registrations and discounts
          </p>
        </div>
        {isOperatorOrAbove && isContextReady && <AddGroupButton />}
      </div>
      {isContextReady && (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <GroupsTableContent />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
