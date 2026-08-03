import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  type Column,
  type ColumnDef,
  type ExpandedState,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type Row,
  type RowSelectionState,
  type SortingState,
  type Table as TanstackTable,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  GripVertical,
  Search,
  X,
} from "lucide-react"
import {
  Fragment,
  type ReactNode,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useIsMobile } from "@/hooks/useMobile"
import {
  applyUserColumnOrder,
  columnDefId,
  type TableColumnPrefs,
  useTableColumnPrefs,
} from "@/hooks/useTableColumnPrefs"
import { cn } from "@/lib/utils"

declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData, TValue> {
    label?: string
    toggleable?: boolean
    defaultHidden?: boolean
    /**
     * Pin the column to an edge so it stays visible while the table scrolls
     * horizontally. Use for a leading identity column ("left") and a trailing
     * actions column ("right") on wide tables with many columns.
     */
    sticky?: "left" | "right"
  }
}

function stickyColumnClassName(sticky?: "left" | "right"): string | undefined {
  if (sticky === "left") return "sticky left-0 z-20 bg-background"
  if (sticky === "right") return "sticky right-0 z-20 bg-background"
  return undefined
}

interface PaginationState {
  pageIndex: number
  pageSize: number
}

interface ServerPaginationProps {
  total: number
  pagination: PaginationState
  onPaginationChange: (pagination: PaginationState) => void
}

interface ServerSortingProps {
  sorting: SortingState
  onSortingChange: (sorting: SortingState) => void
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  searchPlaceholder?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  serverPagination?: ServerPaginationProps
  serverSorting?: ServerSortingProps
  filterBar?: ReactNode
  emptyState?: ReactNode
  selectable?: boolean
  bulkActions?: (selectedRows: TData[]) => ReactNode
  hiddenOnMobile?: string[]
  tableId?: string
  /**
   * Externally-owned column visibility and order state. Lets a page share
   * the preferences across several DataTable instances or feed them into
   * saved views. Defaults to internal tableId-persisted state.
   */
  columnPrefs?: TableColumnPrefs
  /**
   * Suppress the built-in toolbar (search, filter bar, column toggle) while
   * keeping the tableId-based column visibility preferences. Useful when
   * several tables share one external toolbar, as in grouped views.
   */
  hideToolbar?: boolean
  renderSubComponent?: (props: { row: Row<TData> }) => ReactNode
  /**
   * Called when a row is clicked. Clicks that originate inside buttons,
   * links, inputs, dialogs, or elements marked with `data-no-row-click`
   * are ignored, so interactive cells (action menus, checkboxes) keep
   * working without needing `stopPropagation` everywhere.
   */
  onRowClick?: (row: TData) => void
}

function SortableHeader({
  label,
  column,
}: {
  label: string
  column: {
    getIsSorted: () => false | "asc" | "desc"
    toggleSorting: (desc?: boolean) => void
  }
}) {
  const sorted = column.getIsSorted()
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 h-8"
      onClick={() => column.toggleSorting(sorted === "asc")}
    >
      {label}
      {sorted === "asc" ? (
        <ArrowUp className="ml-1 h-3.5 w-3.5" />
      ) : sorted === "desc" ? (
        <ArrowDown className="ml-1 h-3.5 w-3.5" />
      ) : (
        <ArrowUpDown className="ml-1 h-3.5 w-3.5 text-muted-foreground/50" />
      )}
    </Button>
  )
}

export { SortableHeader }

/**
 * Column settings menu: search, toggle visibility with a switch, and drag
 * the handle to reorder. Hidden columns keep their slot so they come back
 * where they were left.
 */
function ColumnPrefsMenu<TData>({
  table,
  prefs,
}: {
  table: TanstackTable<TData>
  prefs: TableColumnPrefs
}) {
  const [query, setQuery] = useState("")
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const orderableColumns = table
    .getAllLeafColumns()
    .filter(
      (col) =>
        col.columnDef.meta?.toggleable !== false && col.columnDef.meta?.label,
    )
  const orderedIds = applyUserColumnOrder(
    orderableColumns.map((col) => col.id),
    prefs.order,
  )
  const rank = new Map(orderedIds.map((id, index) => [id, index]))
  const orderedColumns = [...orderableColumns].sort(
    (a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0),
  )

  const search = query.trim().toLowerCase()
  const visibleRows = search
    ? orderedColumns.filter((col) =>
        col.columnDef.meta?.label?.toLowerCase().includes(search),
      )
    : orderedColumns
  // Reordering a filtered list is ambiguous; drag only on the full list.
  const dndEnabled = !search

  const handleDragEnd = (event: DragEndEvent) => {
    if (!event.over || event.active.id === event.over.id) return
    const oldIndex = orderedIds.indexOf(String(event.active.id))
    const newIndex = orderedIds.indexOf(String(event.over.id))
    if (oldIndex === -1 || newIndex === -1) return
    prefs.setOrder(arrayMove(orderedIds, oldIndex, newIndex))
  }

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="icon"
              className="h-9 w-9 shrink-0"
              aria-label="Columns"
            >
              <Columns3 className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Columns</p>
        </TooltipContent>
      </Tooltip>
      <PopoverContent align="end" className="w-64 p-0">
        <div className="border-b p-2">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search columns..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 pl-8 text-sm"
            />
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto p-1">
          {visibleRows.length === 0 ? (
            <p className="px-2 py-3 text-center text-sm text-muted-foreground">
              No columns found.
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={visibleRows.map((col) => col.id)}
                strategy={verticalListSortingStrategy}
              >
                {visibleRows.map((col) => (
                  <ColumnPrefsRow
                    key={col.id}
                    column={col}
                    dndEnabled={dndEnabled}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ColumnPrefsRow<TData>({
  column,
  dndEnabled,
}: {
  column: Column<TData, unknown>
  dndEnabled: boolean
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: column.id, disabled: !dndEnabled })
  const label = column.columnDef.meta?.label ?? column.id
  const switchId = `column-toggle-${column.id}`

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={cn(
        "flex items-center gap-2 rounded-sm px-1.5 py-1 hover:bg-muted",
        isDragging && "relative z-10 bg-background shadow-md",
      )}
    >
      <button
        type="button"
        aria-label={`Drag to reorder ${label}`}
        disabled={!dndEnabled}
        className={cn(
          "flex h-6 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground/40 transition-colors",
          dndEnabled
            ? "cursor-grab hover:text-muted-foreground active:cursor-grabbing"
            : "opacity-30",
        )}
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-3.5 w-3.5" />
      </button>
      <Label
        htmlFor={switchId}
        className="min-w-0 flex-1 cursor-pointer truncate text-sm font-normal"
        title={label}
      >
        {label}
      </Label>
      <Switch
        id={switchId}
        checked={column.getIsVisible()}
        onCheckedChange={(value) => column.toggleVisibility(!!value)}
      />
    </div>
  )
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  filterBar,
  serverPagination,
  serverSorting,
  emptyState,
  selectable,
  bulkActions,
  hiddenOnMobile,
  tableId,
  columnPrefs,
  hideToolbar,
  renderSubComponent,
  onRowClick,
}: DataTableProps<TData, TValue>) {
  const [localSorting, setLocalSorting] = useState<SortingState>([])
  const sorting = serverSorting ? serverSorting.sorting : localSorting
  const handleSortingChange = serverSorting
    ? (updater: SortingState | ((prev: SortingState) => SortingState)) => {
        const next =
          typeof updater === "function"
            ? updater(serverSorting.sorting)
            : updater
        serverSorting.onSortingChange(next)
      }
    : setLocalSorting
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
  const [expanded, setExpanded] = useState<ExpandedState>({})
  const isMobile = useIsMobile()

  // Debounced search
  const [localSearch, setLocalSearch] = useState(searchValue ?? "")
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  useEffect(() => {
    setLocalSearch(searchValue ?? "")
  }, [searchValue])

  const handleSearchChange = (value: string) => {
    setLocalSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      onSearchChange?.(value)
    }, 300)
  }

  // User column preferences (persisted in localStorage), unless the caller
  // owns them via the columnPrefs prop.
  const internalPrefs = useTableColumnPrefs(tableId)
  const prefs = columnPrefs ?? internalPrefs

  // Merge: defaultHidden from meta → user preferences → mobile overrides (highest priority)
  const columnVisibility = useMemo<VisibilityState>(() => {
    const defaultHidden: VisibilityState = {}
    for (const col of columns) {
      const id = columnDefId(col)
      if (id && col.meta?.defaultHidden) {
        defaultHidden[id] = false
      }
    }

    const mobileOverrides: VisibilityState = {}
    if (isMobile && hiddenOnMobile) {
      for (const id of hiddenOnMobile) {
        mobileOverrides[id] = false
      }
    }

    return { ...defaultHidden, ...prefs.visibility, ...mobileOverrides }
  }, [columns, isMobile, hiddenOnMobile, prefs.visibility])

  const allColumns = useMemo(() => {
    if (!selectable) return columns
    const selectColumn: ColumnDef<TData, TValue> = {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      ),
      enableSorting: false,
    }
    return [selectColumn, ...columns]
  }, [columns, selectable])

  // Full column order for the table: fixed columns (select, sticky identity,
  // actions) keep their slots, the user-orderable ones follow the saved order.
  const columnOrder = useMemo(() => {
    const entries = allColumns.map((col) => ({
      id: columnDefId(col),
      orderable: col.meta?.toggleable !== false && !!col.meta?.label,
    }))
    const orderableIds = entries
      .filter((entry) => entry.orderable && entry.id)
      .map((entry) => entry.id as string)
    const sorted = applyUserColumnOrder(orderableIds, prefs.order)
    let cursor = 0
    return entries
      .map((entry) =>
        entry.orderable && entry.id ? sorted[cursor++] : entry.id,
      )
      .filter((id): id is string => !!id)
  }, [allColumns, prefs.order])

  const isServerPaginated = !!serverPagination

  const table = useReactTable({
    data,
    columns: allColumns,
    getCoreRowModel: getCoreRowModel(),
    ...(!isServerPaginated && {
      getPaginationRowModel: getPaginationRowModel(),
    }),
    ...(serverSorting && { manualSorting: true }),
    ...(!serverSorting && { getSortedRowModel: getSortedRowModel() }),
    ...(renderSubComponent && {
      getExpandedRowModel: getExpandedRowModel(),
      onExpandedChange: setExpanded,
      getRowCanExpand: () => true,
    }),
    onSortingChange: handleSortingChange,
    onColumnVisibilityChange: prefs.setVisibility,
    ...(selectable && {
      onRowSelectionChange: setRowSelection,
    }),
    state: {
      sorting,
      columnVisibility,
      columnOrder,
      ...(renderSubComponent && { expanded }),
      ...(selectable && { rowSelection }),
      ...(isServerPaginated && {
        pagination: serverPagination.pagination,
      }),
    },
    ...(isServerPaginated && {
      manualPagination: true,
      pageCount: Math.ceil(
        serverPagination.total / serverPagination.pagination.pageSize,
      ),
    }),
  })

  const pageCount = table.getPageCount()
  const currentPage = isServerPaginated
    ? serverPagination.pagination.pageIndex
    : table.getState().pagination.pageIndex
  const pageSize = isServerPaginated
    ? serverPagination.pagination.pageSize
    : table.getState().pagination.pageSize
  const totalRows = isServerPaginated ? serverPagination.total : data.length

  const setPageIndex = (index: number) => {
    if (isServerPaginated) {
      serverPagination.onPaginationChange({
        ...serverPagination.pagination,
        pageIndex: index,
      })
    } else {
      table.setPageIndex(index)
    }
  }

  const setPageSize = (size: number) => {
    if (isServerPaginated) {
      serverPagination.onPaginationChange({ pageIndex: 0, pageSize: size })
    } else {
      table.setPageSize(size)
    }
  }

  const hasToolbar = !hideToolbar && (onSearchChange || tableId || filterBar)

  return (
    <div className="flex flex-col gap-4">
      {hasToolbar && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {onSearchChange && (
              <div className="relative w-full min-w-0 sm:max-w-xs">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder={searchPlaceholder ?? "Search..."}
                  value={localSearch}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  className="pl-9 pr-8"
                />
                {localSearch && (
                  <button
                    type="button"
                    onClick={() => handleSearchChange("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )}
            {filterBar && (
              <div className="flex min-w-0 flex-1 items-center">
                {filterBar}
              </div>
            )}
          </div>
          {tableId && <ColumnPrefsMenu table={table} prefs={prefs} />}
        </div>
      )}

      {selectable && bulkActions && Object.keys(rowSelection).length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-2">
          <span className="text-sm font-medium">
            {Object.keys(rowSelection).length} selected
          </span>
          {bulkActions(
            table.getSelectedRowModel().rows.map((row) => row.original),
          )}
        </div>
      )}

      <div className="thin-scrollbar overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead
                      key={header.id}
                      className={stickyColumnClassName(
                        header.column.columnDef.meta?.sticky,
                      )}
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext(),
                          )}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => {
                const expandable = !!renderSubComponent
                const clickable = expandable || !!onRowClick
                const handleClick = (
                  e: React.MouseEvent<HTMLTableRowElement>,
                ) => {
                  if (expandable) {
                    row.toggleExpanded()
                    return
                  }
                  if (!onRowClick) return
                  const target = e.target as HTMLElement
                  // Skip when the click came from any interactive descendant
                  // (action buttons, checkboxes, links, dialog content, etc.).
                  if (
                    target.closest(
                      'button, a, input, select, textarea, [role="menuitem"], [role="dialog"], [data-no-row-click]',
                    )
                  ) {
                    return
                  }
                  onRowClick(row.original)
                }
                return (
                  <Fragment key={row.id}>
                    <TableRow
                      className={clickable ? "cursor-pointer" : undefined}
                      onClick={clickable ? handleClick : undefined}
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          className={stickyColumnClassName(
                            cell.column.columnDef.meta?.sticky,
                          )}
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext(),
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                    {renderSubComponent && row.getIsExpanded() && (
                      <TableRow
                        key={`${row.id}-expanded`}
                        className="hover:bg-transparent"
                      >
                        <TableCell
                          colSpan={row.getVisibleCells().length}
                          className="p-0"
                        >
                          {renderSubComponent({ row })}
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })
            ) : emptyState ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={allColumns.length} className="p-0">
                  {emptyState}
                </TableCell>
              </TableRow>
            ) : (
              <TableRow className="hover:bg-transparent">
                <TableCell
                  colSpan={allColumns.length}
                  className="h-32 text-center text-muted-foreground"
                >
                  No results found.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      {pageCount > 1 && (
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 border-t bg-muted/20">
          <div className="flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="text-sm text-muted-foreground">
              Showing {currentPage * pageSize + 1} to{" "}
              {Math.min((currentPage + 1) * pageSize, totalRows)} of{" "}
              <span className="font-medium text-foreground">{totalRows}</span>{" "}
              entries
            </div>
            <div className="flex items-center gap-x-2">
              <p className="text-sm text-muted-foreground">Rows per page</p>
              <Select
                value={`${pageSize}`}
                onValueChange={(value) => {
                  setPageSize(Number(value))
                }}
              >
                <SelectTrigger className="h-8 w-[70px]">
                  <SelectValue placeholder={pageSize} />
                </SelectTrigger>
                <SelectContent side="top">
                  {[10, 25, 50, 100].map((size) => (
                    <SelectItem key={size} value={`${size}`}>
                      {size}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex items-center gap-x-6">
            <div className="flex items-center gap-x-1 text-sm text-muted-foreground">
              <span>Page</span>
              <span className="font-medium text-foreground">
                {currentPage + 1}
              </span>
              <span>of</span>
              <span className="font-medium text-foreground">{pageCount}</span>
            </div>

            <div className="flex items-center gap-x-1">
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setPageIndex(0)}
                disabled={currentPage === 0}
              >
                <span className="sr-only">Go to first page</span>
                <ChevronsLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setPageIndex(currentPage - 1)}
                disabled={currentPage === 0}
              >
                <span className="sr-only">Go to previous page</span>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setPageIndex(currentPage + 1)}
                disabled={currentPage >= pageCount - 1}
              >
                <span className="sr-only">Go to next page</span>
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 w-8 p-0"
                onClick={() => setPageIndex(pageCount - 1)}
                disabled={currentPage >= pageCount - 1}
              >
                <span className="sr-only">Go to last page</span>
                <ChevronsRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
