import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import {
  type TaskStatus,
  TasksService,
  type TaskType,
  type TaskVisibility,
  TenantsService,
  UsersService,
} from "@/client"
import { DangerZone } from "@/components/Common/DangerZone"
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
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"
import { TaskAttachments } from "./TaskAttachments"
import { TaskCommentThread } from "./TaskCommentThread"
import {
  STATUS_LABELS,
  TASK_STATUSES,
  TASK_TYPES,
  TASK_VISIBILITIES,
  TYPE_LABELS,
  VISIBILITY_LABELS,
} from "./taskMeta"

const NONE = "__none__"

interface TaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When set, the dialog edits an existing task; otherwise it creates one. */
  taskId?: string | null
}

interface FormState {
  title: string
  detail: string
  type: TaskType
  status: TaskStatus
  visibility: TaskVisibility
  target_tenant_id: string
  responsible_user_id: string
  release: string
}

const DEFAULTS: FormState = {
  title: "",
  detail: "",
  type: "feature",
  status: "to_do",
  visibility: "internal",
  target_tenant_id: "",
  responsible_user_id: "",
  release: "",
}

export function TaskDialog({ open, onOpenChange, taskId }: TaskDialogProps) {
  const isEdit = !!taskId
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [form, setForm] = useState<FormState>(DEFAULTS)

  const { data: task } = useQuery({
    queryKey: ["task", taskId],
    queryFn: () => TasksService.getTask({ taskId: taskId! }),
    enabled: open && isEdit,
  })

  const { data: usersData } = useQuery({
    queryKey: ["tasks-users"],
    queryFn: () => UsersService.listUsers({ limit: 1000 }),
    enabled: open,
  })

  const { data: tenantsData } = useQuery({
    queryKey: ["tasks-tenants"],
    queryFn: () => TenantsService.listTenants({ limit: 1000 }),
    enabled: open && form.visibility === "tenant",
  })

  // Reset the form whenever the dialog opens or the loaded task changes.
  useEffect(() => {
    if (!open) return
    if (isEdit && task) {
      setForm({
        title: task.title,
        detail: task.detail ?? "",
        type: task.type,
        status: task.status,
        visibility: task.visibility,
        target_tenant_id: task.target_tenant_id ?? "",
        responsible_user_id: task.responsible_user_id ?? "",
        release: task.release ?? "",
      })
    } else if (!isEdit) {
      setForm(DEFAULTS)
    }
  }, [open, isEdit, task])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }))

  const buildPayload = () => ({
    title: form.title.trim(),
    detail: form.detail.trim() || null,
    type: form.type,
    status: form.status,
    visibility: form.visibility,
    target_tenant_id:
      form.visibility === "tenant" ? form.target_tenant_id || null : null,
    responsible_user_id: form.responsible_user_id || null,
    release: form.release.trim() || null,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["tasks"] })
    if (taskId) queryClient.invalidateQueries({ queryKey: ["task", taskId] })
  }

  const createMutation = useMutation({
    mutationFn: () => TasksService.createTask({ requestBody: buildPayload() }),
    onSuccess: () => {
      showSuccessToast("Task created")
      invalidate()
      onOpenChange(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: () =>
      TasksService.updateTask({ taskId: taskId!, requestBody: buildPayload() }),
    onSuccess: () => {
      showSuccessToast("Task updated")
      invalidate()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: () => TasksService.deleteTask({ taskId: taskId! }),
    onSuccess: () => {
      showSuccessToast("Task deleted")
      invalidate()
      onOpenChange(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const handleSave = () => {
    if (!form.title.trim()) {
      showErrorToast("Title is required")
      return
    }
    if (form.visibility === "tenant" && !form.target_tenant_id) {
      showErrorToast("Pick a tenant for tenant-scoped visibility")
      return
    }
    if (isEdit) updateMutation.mutate()
    else createMutation.mutate()
  }

  const users = usersData?.results ?? []
  const tenants = tenantsData?.results ?? []
  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit task" : "New task"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Update the task, manage attachments and discuss it below."
              : "Track a bug or feature for the EdgeOS product."}
          </DialogDescription>
        </DialogHeader>

        {isEdit && task && (
          <p className="-mt-2 text-xs text-muted-foreground">
            Created by{" "}
            <span className="font-medium text-foreground/80">
              {task.created_by_name ?? "Unknown"}
            </span>{" "}
            · {new Date(task.created_at).toLocaleString()}
          </p>
        )}

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="task-title">Title</Label>
            <Input
              id="task-title"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Short, specific summary"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="task-detail">Detail</Label>
            <Textarea
              id="task-detail"
              rows={4}
              value={form.detail}
              onChange={(e) => set("detail", e.target.value)}
              placeholder="What's the change / problem? Add context, steps, links."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Type</Label>
              <Select
                value={form.type}
                onValueChange={(v) => set("type", v as TaskType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => set("status", v as TaskStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Responsible</Label>
              <Select
                value={form.responsible_user_id || NONE}
                onValueChange={(v) =>
                  set("responsible_user_id", v === NONE ? "" : v)
                }
              >
                <SelectTrigger>
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>Unassigned</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.full_name || u.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="task-release">Release</Label>
              <Input
                id="task-release"
                value={form.release}
                onChange={(e) => set("release", e.target.value)}
                placeholder="e.g. v1.2.0"
              />
            </div>

            <div className="space-y-2">
              <Label>Visibility</Label>
              <Select
                value={form.visibility}
                onValueChange={(v) => set("visibility", v as TaskVisibility)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TASK_VISIBILITIES.map((v) => (
                    <SelectItem key={v} value={v}>
                      {VISIBILITY_LABELS[v]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.visibility === "tenant" && (
              <div className="space-y-2">
                <Label>Tenant</Label>
                <Select
                  value={form.target_tenant_id || NONE}
                  onValueChange={(v) =>
                    set("target_tenant_id", v === NONE ? "" : v)
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a tenant" />
                  </SelectTrigger>
                  <SelectContent>
                    {tenants.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        {isEdit && task && (
          <>
            <Separator />
            <TaskAttachments
              taskId={task.id}
              attachments={task.attachments ?? []}
            />
            <Separator />
            <TaskCommentThread taskId={task.id} />
            <Separator />
            <DangerZone
              description="Permanently delete this task, its comments and attachments. To retire a task instead, set its status to Cancelled."
              onDelete={() => deleteMutation.mutate()}
              isDeleting={deleteMutation.isPending}
              confirmText="Delete Task"
              resourceName={task.title}
              variant="inline"
            />
          </>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton loading={isPending} onClick={handleSave}>
            {isEdit ? "Save changes" : "Create task"}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
