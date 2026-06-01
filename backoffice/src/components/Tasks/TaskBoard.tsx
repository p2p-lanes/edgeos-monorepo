import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { type TaskPublic, type TaskStatus, TasksService } from "@/client"
import useCustomToast from "@/hooks/useCustomToast"
import { cn } from "@/lib/utils"
import { createErrorHandler } from "@/utils"
import { TaskCard } from "./TaskCard"
import { STATUS_CLASSES, STATUS_LABELS, TASK_STATUSES } from "./taskMeta"

interface TaskBoardProps {
  tasks: TaskPublic[]
  onOpen: (taskId: string) => void
}

function Column({
  status,
  tasks,
  onOpen,
}: {
  status: TaskStatus
  tasks: TaskPublic[]
  onOpen: (taskId: string) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex w-72 shrink-0 flex-col rounded-lg bg-muted/40 p-2",
        isOver && "ring-2 ring-primary",
      )}
    >
      <div className="mb-2 flex items-center justify-between px-1">
        <span
          className={cn(
            "rounded border px-2 py-0.5 text-xs font-medium",
            STATUS_CLASSES[status],
          )}
        >
          {STATUS_LABELS[status]}
        </span>
        <span className="text-xs text-muted-foreground">{tasks.length}</span>
      </div>
      <div className="flex min-h-[40px] flex-col gap-2">
        {tasks.map((task) => (
          <TaskCard key={task.id} task={task} onOpen={onOpen} />
        ))}
      </div>
    </div>
  )
}

export function TaskBoard({ tasks, onOpen }: TaskBoardProps) {
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const moveMutation = useMutation({
    mutationFn: ({ taskId, status }: { taskId: string; status: TaskStatus }) =>
      TasksService.updateTaskStatus({ taskId, requestBody: { status } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["tasks"] }),
    onError: createErrorHandler(showErrorToast),
  })

  const byStatus = Object.fromEntries(
    TASK_STATUSES.map((s) => [s, tasks.filter((t) => t.status === s)]),
  ) as Record<TaskStatus, TaskPublic[]>

  const handleDragEnd = (event: DragEndEvent) => {
    const overId = event.over?.id as TaskStatus | undefined
    const current = event.active.data.current?.status as TaskStatus | undefined
    if (!overId || overId === current) return
    moveMutation.mutate({ taskId: String(event.active.id), status: overId })
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {TASK_STATUSES.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={byStatus[status]}
            onOpen={onOpen}
          />
        ))}
      </div>
    </DndContext>
  )
}
