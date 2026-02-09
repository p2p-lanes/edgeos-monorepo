import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  type RowSelectionState,
  type SortingState,
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
  Search,
} from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useIsMobile } from "@/hooks/useMobile"

interface PaginationState {
  pageIndex: number
  pageSize: number
}

interface ServerPaginationProps {
  total: number
  pagination: PaginationState
  onPaginationChange: (pagination: PaginationState) => void
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[]
  data: TData[]
  searchPlaceholder?: string
  searchValue?: string
  onSearchChange?: (value: string) => void
  serverPagination?: ServerPaginationProps
  emptyState?: ReactNode
  selectable?: boolean
  bulkActions?: (selectedRows: TData[]) => ReactNode
  hiddenOnMobile?: string[]
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

export function DataTable<TData, TValue>({
  columns,
  data,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  serverPagination,
  emptyState,
  selectable,
  bulkActions,
  hiddenOnMobile,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([])
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({})
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

  const columnVisibility = useMemo<VisibilityState>(() => {
    if (!isMobile || !hiddenOnMobile) return {}
    return Object.fromEntries(hiddenOnMobile.map((id) => [id, false]))
  }, [isMobile, hiddenOnMobile])

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

  const isServerPaginated = !!serverPagination

  const table = useReactTable({
    data,
    columns: allColumns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(!isServerPaginated && {
      getPaginationRowModel: getPaginationRowModel(),
    }),
    onSortingChange: setSorting,
    ...(selectable && {
      onRowSelectionChange: setRowSelection,
    }),
    state: {
      sorting,
      columnVisibility,
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

  return (
    <div className="flex flex-col gap-4">
      {onSearchChange && (
        <div className="flex items-center gap-3">
          <div className="relative max-w-sm flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={searchPlaceholder ?? "Search..."}
              value={localSearch}
              onChange={(e) => handleSearchChange(e.target.value)}
              className="pl-9"
            />
          </div>
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

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="hover:bg-transparent">
                {headerGroup.headers.map((header) => {
                  return (
                    <TableHead key={header.id}>
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
              table.getRowModel().rows.map((row) => (
                <TableRow key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext(),
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
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
