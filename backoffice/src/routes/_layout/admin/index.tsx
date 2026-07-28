import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { AlertCircle, Plus, Users } from "lucide-react"
import { Suspense, useState } from "react"

import { type UserPublic, UsersService } from "@/client"
import { columns, type UserTableData } from "@/components/Admin/columns"
import { DataTable } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import PendingUsers from "@/components/Pending/PendingUsers"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"

const PAGE_SIZE = 50

function getTenantUsersQueryOptions(
  tenantId: string | null,
  page: number,
  pageSize: number,
  search?: string,
) {
  return {
    queryFn: () =>
      UsersService.listUsers({
        skip: page * pageSize,
        limit: pageSize,
        tenantId: tenantId || undefined,
        search: search || undefined,
      }),
    queryKey: ["users", "tenant", tenantId, { page, pageSize, search }],
    enabled: !!tenantId,
  }
}

function getSuperadminsQueryOptions(
  page: number,
  pageSize: number,
  search?: string,
) {
  return {
    queryFn: () =>
      UsersService.listUsers({
        skip: page * pageSize,
        limit: pageSize,
        role: "superadmin",
        search: search || undefined,
      }),
    queryKey: ["users", "superadmins", { page, pageSize, search }],
  }
}

export const Route = createFileRoute("/_layout/admin/")({
  component: Admin,
  validateSearch: validateTableSearch,
  head: () => ({
    meta: [
      {
        title: "User Management - EdgeOS",
      },
    ],
  }),
})

function AddUserButton() {
  return (
    <Button asChild>
      <Link to="/admin/new">
        <Plus className="mr-2 h-4 w-4" />
        Add User
      </Link>
    </Button>
  )
}

// Row click only navigates when the menu would have shown for this user.
// Mirrors the gating that lived in the deleted UserActionsMenu component.
function canManageUser(
  user: UserPublic,
  ctx: {
    currentUserId: string | undefined
    isSuperadmin: boolean
    isOperator: boolean
  },
): boolean {
  if (user.id === ctx.currentUserId) return false
  if (!ctx.isSuperadmin && user.role === "superadmin") return false
  if (
    ctx.isOperator &&
    (user.role === "admin" ||
      user.role === "operator" ||
      user.role === "superadmin")
  ) {
    return false
  }
  return true
}

function TenantUsersTableContent({ tenantId }: { tenantId: string | null }) {
  const navigate = useNavigate()
  const { user: currentUser, isOperator, isSuperadmin } = useAuth()
  const searchParams = Route.useSearch()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/admin",
  )

  const { data: users } = useQuery({
    ...getTenantUsersQueryOptions(
      tenantId,
      pagination.pageIndex,
      pagination.pageSize,
      search,
    ),
    placeholderData: keepPreviousData,
  })

  if (!users) return <Skeleton className="h-64 w-full" />

  // Operators can only see roles strictly below them (viewer, check_in_controller).
  // Others see everyone except superadmins.
  const tenantUsers = users.results.filter((user: UserPublic) => {
    if (user.role === "superadmin") return false
    if (isOperator) {
      return user.role === "viewer" || user.role === "check_in_controller"
    }
    return true
  })

  const tableData: UserTableData[] = tenantUsers.map((user: UserPublic) => ({
    ...user,
    isCurrentUser: currentUser?.id === user.id,
  }))

  return (
    <DataTable
      columns={columns}
      data={tableData}
      searchPlaceholder="Search by name or email..."
      hiddenOnMobile={["role", "deleted"]}
      searchValue={search}
      onSearchChange={setSearch}
      onRowClick={(user) => {
        if (
          !canManageUser(user, {
            currentUserId: currentUser?.id,
            isSuperadmin,
            isOperator,
          })
        ) {
          return
        }
        navigate({ to: "/admin/$id/edit", params: { id: user.id } })
      }}
      serverPagination={{
        total: users.paging.total,
        pagination: pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        !search ? (
          <EmptyState
            icon={Users}
            title="No users yet"
            description="Add users to manage access for this organization."
            action={
              <Button asChild>
                <Link to="/admin/new">
                  <Plus className="mr-2 h-4 w-4" />
                  Add User
                </Link>
              </Button>
            }
          />
        ) : undefined
      }
    />
  )
}

function SuperadminsTableContent() {
  const navigate = useNavigate()
  const { user: currentUser, isOperator, isSuperadmin } = useAuth()
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [search, setSearch] = useState("")

  const { data: users } = useQuery({
    ...getSuperadminsQueryOptions(
      pagination.pageIndex,
      pagination.pageSize,
      search,
    ),
    placeholderData: keepPreviousData,
  })

  if (!users) return <Skeleton className="h-64 w-full" />

  const tableData: UserTableData[] = users.results.map((user: UserPublic) => ({
    ...user,
    isCurrentUser: currentUser?.id === user.id,
  }))

  return (
    <DataTable
      columns={columns}
      data={tableData}
      searchPlaceholder="Search by name or email..."
      hiddenOnMobile={["role", "deleted"]}
      searchValue={search}
      onSearchChange={(value) => {
        setSearch(value)
        setPagination((prev) => ({ ...prev, pageIndex: 0 }))
      }}
      onRowClick={(user) => {
        if (
          !canManageUser(user, {
            currentUserId: currentUser?.id,
            isSuperadmin,
            isOperator,
          })
        ) {
          return
        }
        navigate({ to: "/admin/$id/edit", params: { id: user.id } })
      }}
      serverPagination={{
        total: users.paging.total,
        pagination: pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        !search ? (
          <EmptyState
            icon={Users}
            title="No superadmins"
            description="Superadmin accounts will appear here."
          />
        ) : undefined
      }
    />
  )
}

function TenantUsersTable({ tenantId }: { tenantId: string | null }) {
  if (!tenantId) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Select an organization</AlertTitle>
        <AlertDescription>
          Please select an organization from the sidebar to view users.
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <QueryErrorBoundary>
      <Suspense fallback={<PendingUsers />}>
        <TenantUsersTableContent tenantId={tenantId} />
      </Suspense>
    </QueryErrorBoundary>
  )
}

function SuperadminsTable() {
  return (
    <QueryErrorBoundary>
      <Suspense fallback={<PendingUsers />}>
        <SuperadminsTableContent />
      </Suspense>
    </QueryErrorBoundary>
  )
}

function Admin() {
  const { isOperatorOrAbove, isSuperadmin } = useAuth()
  const { effectiveTenantId } = useWorkspace()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">User Management</h1>
          <p className="text-muted-foreground">
            Manage user accounts and permissions
          </p>
        </div>
        {isOperatorOrAbove && <AddUserButton />}
      </div>
      {isSuperadmin ? (
        <Tabs defaultValue="tenant-users">
          <TabsList>
            <TabsTrigger value="tenant-users">Users</TabsTrigger>
            <TabsTrigger value="superadmins">Superadmins</TabsTrigger>
          </TabsList>

          <TabsContent value="tenant-users" className="mt-4">
            <TenantUsersTable tenantId={effectiveTenantId} />
          </TabsContent>

          <TabsContent value="superadmins" className="mt-4">
            <SuperadminsTable />
          </TabsContent>
        </Tabs>
      ) : (
        <TenantUsersTable tenantId={effectiveTenantId} />
      )}
    </div>
  )
}
