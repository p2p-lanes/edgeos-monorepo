import type { ColumnDef } from "@tanstack/react-table"

import type { TaskPublic } from "@/client"
import { SortableHeader } from "@/components/Common/DataTable"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  PRIORITY_CLASSES,
  PRIORITY_LABELS,
  STATUS_CLASSES,
  STATUS_LABELS,
  TYPE_CLASSES,
  TYPE_LABELS,
} from "./taskMeta"

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
]
