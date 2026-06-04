import type {
  TaskPriority,
  TaskStatus,
  TaskType,
  TaskVisibility,
} from "@/client"

/** Kanban column order, left → right. */
export const TASK_STATUSES: TaskStatus[] = [
  "to_do",
  "testing",
  "next_release",
  "published",
  "blocked",
  "cancelled",
]

export const STATUS_LABELS: Record<TaskStatus, string> = {
  to_do: "To do",
  testing: "Testing",
  next_release: "Next release",
  published: "Published",
  blocked: "Blocked",
  cancelled: "Cancelled",
}

/** Tailwind classes for the status pill / kanban column accent. */
export const STATUS_CLASSES: Record<TaskStatus, string> = {
  to_do: "bg-slate-100 text-slate-700 border-slate-200",
  testing: "bg-amber-100 text-amber-800 border-amber-200",
  next_release: "bg-blue-100 text-blue-800 border-blue-200",
  published: "bg-emerald-100 text-emerald-800 border-emerald-200",
  blocked: "bg-red-100 text-red-800 border-red-200",
  cancelled: "bg-zinc-100 text-zinc-500 border-zinc-200 line-through",
}

export const TASK_TYPES: TaskType[] = ["bug", "feature"]

export const TYPE_LABELS: Record<TaskType, string> = {
  bug: "Bug",
  feature: "Feature",
}

export const TYPE_CLASSES: Record<TaskType, string> = {
  bug: "bg-rose-100 text-rose-700 border-rose-200",
  feature: "bg-violet-100 text-violet-700 border-violet-200",
}

/** Priority order, low → high. */
export const TASK_PRIORITIES: TaskPriority[] = ["low", "medium", "high"]

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
}

export const PRIORITY_CLASSES: Record<TaskPriority, string> = {
  low: "bg-slate-100 text-slate-600 border-slate-200",
  medium: "bg-sky-100 text-sky-700 border-sky-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
}

export const TASK_VISIBILITIES: TaskVisibility[] = [
  "internal",
  "universal",
  "tenant",
]

export const VISIBILITY_LABELS: Record<TaskVisibility, string> = {
  internal: "Internal (superadmins)",
  universal: "Universal (all tenants)",
  tenant: "Tenant",
}
