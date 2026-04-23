import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { ApplicationsService } from "@/client"
import { queryKeys } from "@/lib/query-keys"
import { useCityProvider } from "@/providers/cityProvider"
import type { AttendeeDirectory } from "@/types/Attendee"

const useGetData = () => {
  const { getCity } = useCityProvider()
  const city = getCity()
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [pageSize, setPageSize] = useState<number>(10)

  const [searchQuery, setSearchQuery] = useState<string>("")
  const [activeSearch, setActiveSearch] = useState<string>("")

  const { data, isLoading: loading } = useQuery({
    queryKey: [
      ...queryKeys.attendees.directory(city?.id ?? ""),
      currentPage,
      pageSize,
      activeSearch,
    ],
    queryFn: async () => {
      const result = await ApplicationsService.listAttendeesDirectory({
        popupId: city!.id,
        skip: (currentPage - 1) * pageSize,
        limit: pageSize,
        q: activeSearch || undefined,
      })
      return {
        items: result.results as AttendeeDirectory[],
        total: result.paging.total,
      }
    },
    enabled: !!city?.id,
  })

  const handlePageChange = (page: number) => {
    setCurrentPage(page)
  }

  const handlePageSizeChange = (size: number) => {
    setPageSize(size)
    setCurrentPage(1)
  }

  const applySearch = () => {
    setActiveSearch(searchQuery)
    setCurrentPage(1)
  }

  return {
    attendees: data?.items ?? [],
    loading,
    totalAttendees: data?.total ?? 0,
    currentPage,
    pageSize,
    handlePageChange,
    handlePageSizeChange,
    searchQuery,
    setSearchQuery,
    applySearch,
  }
}

export default useGetData
