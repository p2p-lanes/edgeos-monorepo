import { useQuery } from "@tanstack/react-query"
import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { Archive, ListChecks, Plus } from "lucide-react"
import { useMemo, useState } from "react"

import {
  type TaskPublic,
  TasksService,
  type TaskType,
  UsersService,
} from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { taskColumns } from "@/components/Tasks/columns"
import { TaskBoard } from "@/components/Tasks/TaskBoard"
import { TaskDialog } from "@/components/Tasks/TaskDialog"
import { TASK_TYPES, TYPE_LABELS } from "@/components/Tasks/taskMeta"
import { useTaskArchive } from "@/components/Tasks/useTaskArchive"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import useAuth from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout/tasks/")({
  component: Tasks,
  // `?task=<id>` deep-links straight into a task's modal (shareable link).
  validateSearch: (search: Record<string, unknown>): { task?: string } => ({
    task: typeof search.task === "string" ? search.task : undefined,
  }),
  head: () => ({
    meta: [{ title: "Tasks - EdgeOS" }],
  }),
})

function Tasks() {
  const navigate = useNavigate()
  const { task: taskParam } = Route.useSearch()
  const { isSuperadmin, isUserLoading } = useAuth()
  const [search, setSearch] = useState("")
  const [typeFilter, setTypeFilter] = useState<TaskType | "all">("all")
  const [responsibleFilter, setResponsibleFilter] = useState<string>("all")
  const [newOpen, setNewOpen] = useState(false)
  const [tab, setTab] = useState("kanban")
  const [confirmArchiveOpen, setConfirmArchiveOpen] = useState(false)

  const { archivePublished } = useTaskArchive()

  // Active board (non-archived). Open to every backoffice user; the backend
  // filters by task visibility.
  const { data, isLoading } = useQuery({
    queryKey: ["tasks", "board"],
    queryFn: () => TasksService.listTasks({ limit: 1000, archived: false }),
  })

  // Archived tasks — only fetched while the Archived tab is open.
  const { data: archivedData, isLoading: archivedLoading } = useQuery({
    queryKey: ["tasks", "archived"],
    queryFn: () => TasksService.listTasks({ limit: 1000, archived: true }),
    enabled: tab === "archived",
  })

  // Only superadmins can be assigned, so the filter lists superadmins only
  // (and only superadmins may list users).
  const { data: usersData } = useQuery({
    queryKey: ["tasks-superadmins"],
    queryFn: () => UsersService.listUsers({ limit: 1000, role: "superadmin" }),
    enabled: isSuperadmin,
  })
  const users = usersData?.results ?? []

  const applyFilters = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (tasks: TaskPublic[]) =>
      tasks.filter((task) => {
        if (typeFilter !== "all" && task.type !== typeFilter) return false
        if (responsibleFilter === "unassigned") {
          if (task.responsible_user_id) return false
        } else if (
          responsibleFilter !== "all" &&
          task.responsible_user_id !== responsibleFilter
        ) {
          return false
        }
        if (!q) return true
        return (
          task.title.toLowerCase().includes(q) ||
          (task.detail ?? "").toLowerCase().includes(q)
        )
      })
  }, [typeFilter, responsibleFilter, search])

  const filtered = useMemo(
    () => applyFilters(data?.results ?? []),
    [applyFilters, data],
  )
  const filteredArchived = useMemo(
    () => applyFilters(archivedData?.results ?? []),
    [applyFilters, archivedData],
  )

  // Published tasks eligible for the bulk archive (board is already
  // non-archived, so every published row here can be archived).
  const publishedCount = useMemo(
    () => (data?.results ?? []).filter((t) => t.status === "published").length,
    [data],
  )

  if (isUserLoading) return null

  const openNewTask = () => setNewOpen(true)
  const openTask = (taskId: string) =>
    navigate({ to: "/tasks", search: { task: taskId } })
  const closeTask = () => navigate({ to: "/tasks", search: {} })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tasks</h1>
          <p className="text-muted-foreground">
            Track bugs and features for the EdgeOS product
          </p>
        </div>
        {isSuperadmin && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              disabled={publishedCount === 0}
              onClick={() => setConfirmArchiveOpen(true)}
            >
              <Archive className="mr-2 h-4 w-4" />
              Archive published
            </Button>
            <Button onClick={openNewTask}>
              <Plus className="mr-2 h-4 w-4" />
              New task
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search title or detail…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
        />
        <Select
          value={typeFilter}
          onValueChange={(v) => setTypeFilter(v as TaskType | "all")}
        >
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {TASK_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {TYPE_LABELS[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {isSuperadmin && (
          <Select
            value={responsibleFilter}
            onValueChange={setResponsibleFilter}
          >
            <SelectTrigger className="w-52">
              <SelectValue placeholder="Responsible" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All responsibles</SelectItem>
              <SelectItem value="unassigned">Unassigned</SelectItem>
              {users.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.full_name || u.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="kanban">Kanban</TabsTrigger>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="archived">Archived</TabsTrigger>
        </TabsList>

        <TabsContent value="kanban" className="mt-4">
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No tasks yet"
              description="Create a task to start tracking bugs and features."
              action={
                isSuperadmin ? (
                  <Button onClick={openNewTask}>
                    <Plus className="mr-2 h-4 w-4" />
                    New task
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <TaskBoard
              tasks={filtered}
              onOpen={openTask}
              canManage={isSuperadmin}
            />
          )}
        </TabsContent>

        <TabsContent value="list" className="mt-4">
          {isLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <DataTable
              columns={taskColumns}
              data={filtered}
              onRowClick={(task) => openTask(task.id)}
              emptyState={
                <EmptyState
                  icon={ListChecks}
                  title="No tasks yet"
                  description="Create a task to start tracking bugs and features."
                />
              }
            />
          )}
        </TabsContent>

        <TabsContent value="archived" className="mt-4">
          {archivedLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <DataTable
              columns={taskColumns}
              data={filteredArchived}
              onRowClick={(task) => openTask(task.id)}
              emptyState={
                <EmptyState
                  icon={Archive}
                  title="No archived tasks"
                  description="Archived tasks show up here. Archive published tasks after a release to keep the board tidy."
                />
              }
            />
          )}
        </TabsContent>
      </Tabs>

      {/* Create dialog (superadmin) and the deep-linkable view/edit dialog. */}
      <TaskDialog open={newOpen} onOpenChange={setNewOpen} taskId={null} />
      <TaskDialog
        open={!!taskParam}
        onOpenChange={(o) => {
          if (!o) closeTask()
        }}
        taskId={taskParam ?? null}
      />

      {/* Bulk archive confirmation. */}
      <Dialog open={confirmArchiveOpen} onOpenChange={setConfirmArchiveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Archive published tasks?</DialogTitle>
            <DialogDescription>
              This archives the {publishedCount} task
              {publishedCount === 1 ? "" : "s"} in the Published column. They
              move to the Archived tab and can be unarchived individually.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmArchiveOpen(false)}
            >
              Cancel
            </Button>
            <LoadingButton
              loading={archivePublished.isPending}
              onClick={() =>
                archivePublished.mutate(undefined, {
                  onSuccess: () => setConfirmArchiveOpen(false),
                })
              }
            >
              <Archive className="mr-2 h-4 w-4" />
              Archive {publishedCount} task{publishedCount === 1 ? "" : "s"}
            </LoadingButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
