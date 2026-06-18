import type React from "react"
import { useTranslation } from "react-i18next"
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Page-size choices for the directory. Kept modest so the default (10) stays
// snappy while power users can pull more rows at once.
const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

/**
 * 1-based inclusive range of rows shown on the current page, for a
 * "Showing X–Y of Z" label. Returns {0, 0} when empty and clamps the upper
 * bound so a short final page reads correctly (e.g. page 25 of 247 → 241–247).
 */
export function pageRange(
  currentPage: number,
  pageSize: number,
  totalItems: number,
): { from: number; to: number } {
  if (totalItems === 0) return { from: 0, to: 0 }
  return {
    from: (currentPage - 1) * pageSize + 1,
    to: Math.min(currentPage * pageSize, totalItems),
  }
}

type PaginationControlsProps = {
  currentPage: number
  totalItems: number
  pageSize: number
  onPageChange: (page: number) => void
  onPageSizeChange: (size: number) => void
}

const PaginationControls = ({
  currentPage,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: PaginationControlsProps) => {
  const { t } = useTranslation()
  const totalPages = Math.ceil(totalItems / pageSize)

  // 1-based range of the rows currently on screen, e.g. "11–20 of 247".
  const { from: rangeFrom, to: rangeTo } = pageRange(
    currentPage,
    pageSize,
    totalItems,
  )

  // Generar array de páginas a mostrar
  const getPageNumbers = () => {
    const pages = []
    // Siempre mostrar la primera página
    pages.push(1)

    // Calcular rango de páginas alrededor de la página actual
    const startPage = Math.max(2, currentPage - 1)
    const endPage = Math.min(totalPages - 1, currentPage + 1)

    // Ajustar para mostrar 3 páginas siempre que sea posible
    if (startPage > 2) pages.push(-1) // Ellipsis
    for (let i = startPage; i <= endPage; i++) {
      pages.push(i)
    }
    if (endPage < totalPages - 1) pages.push(-2) // Ellipsis

    // Siempre mostrar la última página si hay más de una
    if (totalPages > 1) pages.push(totalPages)

    return pages
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 mt-4">
      {/* Result range + page-size picker. Changing the size resets to page 1
          upstream (useGetData), so larger pages "just work". */}
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span>
          {t("attendees.showing_range", {
            from: rangeFrom,
            to: rangeTo,
            total: totalItems,
          })}
        </span>
        <div className="flex items-center gap-2">
          <span>{t("attendees.per_page_label")}</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger
              className="h-8 w-[4.5rem]"
              aria-label={t("attendees.per_page_label")}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZE_OPTIONS.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Pagination className="mx-0 w-auto">
        <PaginationContent>
          <PaginationItem>
            <PaginationPrevious
              href="#"
              onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                e.preventDefault()
                if (currentPage > 1) onPageChange(currentPage - 1)
              }}
              aria-disabled={currentPage === 1}
              tabIndex={currentPage === 1 ? -1 : 0}
              className={
                currentPage === 1 ? "pointer-events-none opacity-50" : ""
              }
            />
          </PaginationItem>

          {getPageNumbers().map((pageNumber, i) => {
            if (pageNumber === -1 || pageNumber === -2) {
              return (
                <PaginationItem key={`ellipsis-${i}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              )
            }

            return (
              <PaginationItem key={`page-${pageNumber}`}>
                <PaginationLink
                  href="#"
                  onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                    e.preventDefault()
                    onPageChange(pageNumber)
                  }}
                  isActive={pageNumber === currentPage}
                >
                  {pageNumber}
                </PaginationLink>
              </PaginationItem>
            )
          })}

          <PaginationItem>
            <PaginationNext
              href="#"
              onClick={(e: React.MouseEvent<HTMLAnchorElement>) => {
                e.preventDefault()
                if (currentPage < totalPages) onPageChange(currentPage + 1)
              }}
              aria-disabled={currentPage >= totalPages}
              tabIndex={currentPage >= totalPages ? -1 : 0}
              className={
                currentPage >= totalPages
                  ? "pointer-events-none opacity-50"
                  : ""
              }
            />
          </PaginationItem>
        </PaginationContent>
      </Pagination>
    </div>
  )
}

export default PaginationControls
