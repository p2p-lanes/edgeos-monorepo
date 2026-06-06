import { useDraggable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { Archive, ArchiveRestore } from "lucide-react"

import type { TaskPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import useAuth from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
import { APP_LABELS, TYPE_CLASSES, TYPE_LABELS } from "./taskMeta"
import { useTaskArchive } from "./useTaskArchive"

interface TaskCardProps {
  task: TaskPublic
  onOpen: (taskId: string) => void
  /** When false the card can be opened but not dragged between columns. */
  draggable?: boolean
}

export function TaskCard({ task, onOpen, draggable = true }: TaskCardProps) {
  const { isSuperadmin } = useAuth()
  const { archive, unarchive } = useTaskArchive()
  const isArchived = task.archived_at != null
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: task.id,
      data: { status: task.status },
      disabled: !draggable,
    })

  // The card itself is a <button>; the quick archive action is a sibling
  // (absolutely positioned) so we never nest interactive elements. The
  // draggable node is the wrapper; the button is the drag handle.
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn("group relative", isDragging && "opacity-50")}
    >
      <button
        type="button"
        {...listeners}
        {...attributes}
        onClick={() => onOpen(task.id)}
        className={cn(
          "w-full rounded-lg border bg-card p-3 text-left shadow-sm transition-shadow hover:shadow-md",
          draggable && "cursor-grab active:cursor-grabbing",
        )}
      >
        <div className="mb-2 flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn("font-normal", TYPE_CLASSES[task.type])}
          >
            {TYPE_LABELS[task.type]}
          </Badge>
          {task.app && (
            <Badge variant="secondary" className="font-normal">
              {APP_LABELS[task.app]}
            </Badge>
          )}
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
          {isSuperadmin && task.visibility !== "internal" && (
            <span className="shrink-0 text-[11px] uppercase text-muted-foreground">
              {task.visibility}
            </span>
          )}
        </div>
      </button>
      {isSuperadmin && (
        <button
          type="button"
          aria-label={isArchived ? "Unarchive task" : "Archive task"}
          title={isArchived ? "Unarchive" : "Archive"}
          disabled={archive.isPending || unarchive.isPending}
          onClick={() =>
            isArchived ? unarchive.mutate(task.id) : archive.mutate(task.id)
          }
          className="absolute right-1.5 top-1.5 rounded-md border bg-background p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
        >
          {isArchived ? (
            <ArchiveRestore className="h-3.5 w-3.5" />
          ) : (
            <Archive className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </div>
  )
}
