import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import { AlertCircle, Plus } from "lucide-react"
import { Suspense } from "react"

import { type UserPublic, UsersService } from "@/client"
import { columns, type UserTableData } from "@/components/Admin/columns"
import { DataTable } from "@/components/Common/DataTable"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import PendingUsers from "@/components/Pending/PendingUsers"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"

function getTenantUsersQueryOptions(tenantId: string | null) {
  return {
    queryFn: () =>
      UsersService.listUsers({
        skip: 0,
        limit: 100,
        tenantId: tenantId || undefined,
      }),
    queryKey: ["users", "tenant", tenantId],
    enabled: !!tenantId,
  }
}

function getSuperadminsQueryOptions() {
  return {
    queryFn: () =>
      UsersService.listUsers({
        skip: 0,
        limit: 100,
        role: "superadmin",
      }),
    queryKey: ["users", "superadmins"],
  }
}

export const Route = createFileRoute("/_layout/admin/")({
  component: Admin,
  head: () => ({
    meta: [
      {
        title: "User Management - EdgeOS",
      },
    ],
  }),
})

// Add User Button - Links to dedicated create page
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
  const { data: users } = useSuspenseQuery(getTenantUsersQueryOptions(tenantId))

  // Filter out superadmins from tenant users view
  const tenantUsers = users.results.filter(
    (user: UserPublic) => user.role !== "superadmin",
  )

  const tableData: UserTableData[] = tenantUsers.map((user: UserPublic) => ({
    ...user,
    isCurrentUser: currentUser?.id === user.id,
  }))

  return <DataTable columns={columns} data={tableData} />
}

function SuperadminsTableContent() {
  const { user: currentUser } = useAuth()
  const { data: users } = useSuspenseQuery(getSuperadminsQueryOptions())

  const tableData: UserTableData[] = users.results.map((user: UserPublic) => ({
    ...user,
    isCurrentUser: currentUser?.id === user.id,
  }))

  return <DataTable columns={columns} data={tableData} />
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
        // Non-superadmin sees only their tenant's users
        <TenantUsersTable tenantId={effectiveTenantId} />
      )}
    </div>
  )
}
