import { useNavigate } from "@tanstack/react-router"
import { useCallback } from "react"

export interface TableSearchParams {
  page?: number
  pageSize?: number
  search?: string
}

export const defaultTableSearch: Required<TableSearchParams> = {
  page: 0,
  pageSize: 25,
  search: "",
}

export function validateTableSearch(
  raw: Record<string, unknown>,
): TableSearchParams {
  return {
    page: typeof raw.page === "number" && raw.page >= 0 ? raw.page : 0,
    pageSize:
      typeof raw.pageSize === "number" &&
      [10, 25, 50, 100].includes(raw.pageSize)
        ? raw.pageSize
        : 25,
    search: typeof raw.search === "string" ? raw.search : "",
  }
}

export function useTableSearchParams(params: TableSearchParams, from: string) {
  const navigate = useNavigate()

  const page = params.page ?? 0
  const pageSize = params.pageSize ?? 25
  const search = params.search ?? ""

  const pagination = { pageIndex: page, pageSize }

  const setSearch = useCallback(
    (value: string) => {
      navigate({
        to: from,
        search: (prev: TableSearchParams) => ({
          ...prev,
          search: value || undefined,
          page: 0,
        }),
        replace: true,
      })
    },
    [navigate, from],
  )

  const setPagination = useCallback(
    (pag: { pageIndex: number; pageSize: number }) => {
      navigate({
        to: from,
        search: (prev: TableSearchParams) => ({
          ...prev,
          page: pag.pageIndex || undefined,
          pageSize: pag.pageSize === 25 ? undefined : pag.pageSize,
        }),
        replace: true,
      })
    },
    [navigate, from],
  )

  return { search, pagination, setSearch, setPagination }
}
