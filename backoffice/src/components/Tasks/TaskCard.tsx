import { useDraggable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"

import type { TaskPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { TYPE_CLASSES, TYPE_LABELS } from "./taskMeta"

interface TaskCardProps {
  task: TaskPublic
  onOpen: (taskId: string) => void
}

export function TaskCard({ task, onOpen }: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: task.id, data: { status: task.status } })

  return (
    <button
      type="button"
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...listeners}
      {...attributes}
      onClick={() => onOpen(task.id)}
      className={cn(
        "w-full cursor-grab rounded-lg border bg-card p-3 text-left shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing",
        isDragging && "opacity-50",
      )}
    >
      <div className="mb-2 flex items-center gap-2">
        <Badge
          variant="outline"
          className={cn("font-normal", TYPE_CLASSES[task.type])}
        >
          {TYPE_LABELS[task.type]}
        </Badge>
        {task.release && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {task.release}
          </span>
        )}
      </div>
      <p className="text-sm font-medium leading-snug">{task.title}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">
          {task.responsible_name ?? "Unassigned"}
        </span>
        {task.visibility !== "internal" && (
          <span className="shrink-0 text-[11px] uppercase text-muted-foreground">
            {task.visibility}
          </span>
        )}
      </div>
    </button>
  )
}
