"use client"

import { FileDown, Loader2 } from "lucide-react"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import Permissions from "@/components/Permissions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import AttendeesTable from "./components/AttendeesTable"
import useExportCsv from "./hooks/useExportCsv"
import useGetData from "./hooks/useGetData"

const Page = () => {
  const { t } = useTranslation()
  const {
    attendees,
    loading,
    totalAttendees,
    currentPage,
    pageSize,
    handlePageChange,
    handlePageSizeChange,
    searchQuery,
    setSearchQuery,
    applySearch,
  } = useGetData()
  const { isExporting, handleExportCsv } = useExportCsv()

  const handleSearchKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Enter") {
      applySearch()
    }
  }

  // Debounce search query: auto-apply after 300ms of inactivity
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      applySearch()
    }, 300)
    return () => clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applySearch])

  return (
    <TooltipProvider>
      <Permissions>
        <div className="flex flex-col h-full max-w-5xl mx-auto p-6">
          <div className="flex-none">
            <h1 className="text-2xl font-semibold tracking-tight">
              {t("attendees.title")}
            </h1>
            <p className="text-sm text-muted-foreground mt-4">
              {t("attendees.description")}
            </p>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Input
              aria-label="Search in directory"
              placeholder={t("attendees.search_placeholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              className="bg-card"
            />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Export attendees as CSV"
                  className="bg-card text-foreground hover:bg-card hover:shadow-md"
                  onClick={handleExportCsv}
                  disabled={isExporting}
                >
                  {isExporting ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <FileDown className="w-4 h-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>{t("attendees.export_csv")}</p>
              </TooltipContent>
            </Tooltip>
          </div>

          <AttendeesTable
            attendees={attendees}
            loading={loading}
            totalAttendees={totalAttendees}
            currentPage={currentPage}
            pageSize={pageSize}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        </div>
      </Permissions>
    </TooltipProvider>
  )
}

export default Page
