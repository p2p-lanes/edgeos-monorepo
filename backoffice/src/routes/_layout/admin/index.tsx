import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import {
  useTableSearchParams,
  validateTableSearch,
} from "@/hooks/useTableSearchParams"

const PAGE_SIZE = 25

function getTenantUsersQueryOptions(
  tenantId: string | null,
  page: number,
  pageSize: number,
) {
  return {
    queryFn: () =>
      UsersService.listUsers({
        skip: page * pageSize,
        limit: pageSize,
        tenantId: tenantId || undefined,
      }),
    queryKey: ["users", "tenant", tenantId, { page, pageSize }],
    enabled: !!tenantId,
  }
}

function getSuperadminsQueryOptions(page: number, pageSize: number) {
  return {
    queryFn: () =>
      UsersService.listUsers({
        skip: page * pageSize,
        limit: pageSize,
        role: "superadmin",
      }),
    queryKey: ["users", "superadmins", { page, pageSize }],
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

function TenantUsersTableContent({ tenantId }: { tenantId: string | null }) {
  const { user: currentUser } = useAuth()
  const searchParams = Route.useSearch()
  const { search, pagination, setSearch, setPagination } = useTableSearchParams(
    searchParams,
    "/admin",
  )

  const { data: users } = useSuspenseQuery(
    getTenantUsersQueryOptions(
      tenantId,
      pagination.pageIndex,
      pagination.pageSize,
    ),
  )

  const tenantUsers = users.results.filter(
    (user: UserPublic) => user.role !== "superadmin",
  )

  const filtered = search
    ? tenantUsers.filter((u: UserPublic) => {
        const term = search.toLowerCase()
        return (
          (u.full_name ?? "").toLowerCase().includes(term) ||
          u.email.toLowerCase().includes(term)
        )
      })
    : tenantUsers

  const tableData: UserTableData[] = filtered.map((user: UserPublic) => ({
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
      serverPagination={{
        total: search ? filtered.length : users.paging.total,
        pagination: search
          ? { pageIndex: 0, pageSize: users.paging.total }
          : pagination,
        onPaginationChange: setPagination,
      }}
      emptyState={
        !search ? (
          <EmptyState
            icon={Users}
            title="No users yet"
            description="Add users to manage access for this tenant."
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
  const { user: currentUser } = useAuth()
  const [pagination, setPagination] = useState({
    pageIndex: 0,
    pageSize: PAGE_SIZE,
  })
  const [search, setSearch] = useState("")

  const { data: users } = useSuspenseQuery(
    getSuperadminsQueryOptions(pagination.pageIndex, pagination.pageSize),
  )

  const filtered = search
    ? users.results.filter((u: UserPublic) => {
        const term = search.toLowerCase()
        return (
          (u.full_name ?? "").toLowerCase().includes(term) ||
          u.email.toLowerCase().includes(term)
        )
      })
    : users.results

  const tableData: UserTableData[] = filtered.map((user: UserPublic) => ({
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
      serverPagination={{
        total: search ? filtered.length : users.paging.total,
        pagination: search
          ? { pageIndex: 0, pageSize: users.paging.total }
          : pagination,
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
        <AlertTitle>Select a tenant</AlertTitle>
        <AlertDescription>
          Please select a tenant from the sidebar to view users.
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
  const { isAdmin, isSuperadmin } = useAuth()
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
        {isAdmin && <AddUserButton />}
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
