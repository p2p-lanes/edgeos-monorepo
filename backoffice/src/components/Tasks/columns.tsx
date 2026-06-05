import type { ColumnDef } from "@tanstack/react-table"
import { Archive, ArchiveRestore } from "lucide-react"

import type { TaskPublic } from "@/client"
import { SortableHeader } from "@/components/Common/DataTable"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import useAuth from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
import {
  PRIORITY_CLASSES,
  PRIORITY_LABELS,
  STATUS_CLASSES,
  STATUS_LABELS,
  TYPE_CLASSES,
  TYPE_LABELS,
} from "./taskMeta"
import { useTaskArchive } from "./useTaskArchive"

function ArchiveCell({ task }: { task: TaskPublic }) {
  const { isSuperadmin } = useAuth()
  const { archive, unarchive } = useTaskArchive()
  if (!isSuperadmin) return null
  const isArchived = task.archived_at != null
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 px-2 text-xs"
      disabled={archive.isPending || unarchive.isPending}
      onClick={(e) => {
        // The row is clickable (opens the task); keep this action local.
        e.stopPropagation()
        if (isArchived) unarchive.mutate(task.id)
        else archive.mutate(task.id)
      }}
    >
      {isArchived ? (
        <>
          <ArchiveRestore className="mr-1 h-3.5 w-3.5" />
          Unarchive
        </>
      ) : (
        <>
          <Archive className="mr-1 h-3.5 w-3.5" />
          Archive
        </>
      )}
    </Button>
  )
}

export const taskColumns: ColumnDef<TaskPublic>[] = [
  {
    accessorKey: "title",
    header: ({ column }) => <SortableHeader label="Title" column={column} />,
    cell: ({ row }) => (
      <span className="font-medium">{row.original.title}</span>
    ),
  },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => (
      <Badge
        variant="outline"
        className={cn("font-normal", TYPE_CLASSES[row.original.type])}
      >
        {TYPE_LABELS[row.original.type]}
      </Badge>
    ),
  },
  {
    accessorKey: "priority",
    header: "Priority",
    cell: ({ row }) => {
      const priority = row.original.priority ?? "medium"
      return (
        <Badge
          variant="outline"
          className={cn("font-normal", PRIORITY_CLASSES[priority])}
        >
          {PRIORITY_LABELS[priority]}
        </Badge>
      )
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge
        variant="outline"
        className={cn("font-normal", STATUS_CLASSES[row.original.status])}
      >
        {STATUS_LABELS[row.original.status]}
      </Badge>
    ),
  },
  {
    accessorKey: "responsible_name",
    header: "Responsible",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.responsible_name ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "created_by_name",
    header: "Created by",
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {row.original.created_by_name ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "release",
    header: "Release",
    cell: ({ row }) => (
      <span className="font-mono text-xs text-muted-foreground">
        {row.original.release ?? "—"}
      </span>
    ),
  },
  {
    accessorKey: "updated_at",
    header: ({ column }) => <SortableHeader label="Updated" column={column} />,
    cell: ({ row }) => (
      <span className="text-sm text-muted-foreground">
        {new Date(row.original.updated_at).toLocaleDateString()}
      </span>
    ),
  },
  {
    id: "actions",
    header: "",
    cell: ({ row }) => <ArchiveCell task={row.original} />,
  },
]
