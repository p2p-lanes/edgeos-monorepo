import type { ColumnDef, VisibilityState } from "@tanstack/react-table"
import { useCallback, useMemo, useState } from "react"

/**
 * Resolve the id TanStack Table assigns to a column definition: an explicit
 * id wins, otherwise the accessorKey with dots replaced by underscores.
 */
export function columnDefId<TData, TValue>(
  col: ColumnDef<TData, TValue>,
): string | undefined {
  if (col.id) return col.id
  if ("accessorKey" in col && col.accessorKey != null) {
    return String(col.accessorKey).replace(/\./g, "_")
  }
  return undefined
}

/** Ids of the columns users can toggle and reorder, in definition order. */
export function orderableColumnIds<TData, TValue>(
  columns: ColumnDef<TData, TValue>[],
): string[] {
  return columns
    .filter((col) => col.meta?.toggleable !== false && col.meta?.label)
    .map(columnDefId)
    .filter((id): id is string => !!id)
}

/**
 * Reorder ids per the user preference: known ids follow the saved order,
 * anything the preference does not mention (e.g. new custom fields) keeps
 * its natural relative order at the end.
 */
export function applyUserColumnOrder(
  ids: string[],
  userOrder: string[],
): string[] {
  if (!userOrder.length) return ids
  const present = new Set(ids)
  const ordered = userOrder.filter((id) => present.has(id))
  const orderedSet = new Set(ordered)
  return [...ordered, ...ids.filter((id) => !orderedSet.has(id))]
}

export interface TableColumnPrefs {
  visibility: VisibilityState
  order: string[]
  setVisibility: (
    updater: VisibilityState | ((prev: VisibilityState) => VisibilityState),
  ) => void
  setOrder: (order: string[]) => void
  /** True once the user diverged from the default columns in any way. */
  isCustomized: boolean
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

/**
 * Column visibility and order preferences for a table, persisted per tableId
 * in localStorage. Without a tableId the state is kept in memory only.
 */
export function useTableColumnPrefs(tableId?: string): TableColumnPrefs {
  const [visibility, setVisibilityState] = useState<VisibilityState>(() =>
    tableId ? load(`table-columns-${tableId}`, {}) : {},
  )
  const [order, setOrderState] = useState<string[]>(() => {
    const stored = tableId
      ? load<unknown>(`table-column-order-${tableId}`, [])
      : []
    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === "string")
      : []
  })

  const setVisibility = useCallback(
    (
      updater: VisibilityState | ((prev: VisibilityState) => VisibilityState),
    ) => {
      setVisibilityState((prev) => {
        const next = typeof updater === "function" ? updater(prev) : updater
        if (tableId) {
          localStorage.setItem(`table-columns-${tableId}`, JSON.stringify(next))
        }
        return next
      })
    },
    [tableId],
  )

  const setOrder = useCallback(
    (next: string[]) => {
      setOrderState(next)
      if (tableId) {
        localStorage.setItem(
          `table-column-order-${tableId}`,
          JSON.stringify(next),
        )
      }
    },
    [tableId],
  )

  return useMemo(
    () => ({
      visibility,
      order,
      setVisibility,
      setOrder,
      isCustomized: order.length > 0 || Object.keys(visibility).length > 0,
    }),
    [visibility, order, setVisibility, setOrder],
  )
}
