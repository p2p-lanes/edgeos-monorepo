"use client"

import { FileDown, ListFilter, Loader2 } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import Permissions from "@/components/Permissions"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Switch } from "../../../../components/ui/switch"
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
    // filters
    searchQuery,
    setSearchQuery,
    bringsKids,
    setBringsKids,
    selectedWeeks,
    handleToggleWeek,
    applyFilters,
    clearFilters,
  } = useGetData()
  const [filtersOpen, setFiltersOpen] = useState(false)
  const { isExporting, handleExportCsv } = useExportCsv()

  const handleSearchKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (event.key === "Enter") {
      applyFilters()
    }
  }

  // Debounce search query: auto-apply after 300ms of inactivity
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      applyFilters()
    }, 300)
    return () => clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applyFilters])

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
              className="bg-white"
            />
            {(searchQuery.trim() !== "" ||
              bringsKids !== null ||
              selectedWeeks.length > 0) && (
              <Button
                variant="ghost"
                aria-label="Clear filters"
                onClick={clearFilters}
                className="bg-red-500 text-white hover:bg-red-500 hover:shadow-md hover:text-white"
              >
                {t("attendees.clear_filters")}
              </Button>
            )}
            <Dialog open={filtersOpen} onOpenChange={setFiltersOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DialogTrigger asChild>
                    <Button
                      aria-label="Open filters"
                      className="bg-white text-black hover:bg-white hover:shadow-md"
                    >
                      <ListFilter className="w-4 h-4" />
                    </Button>
                  </DialogTrigger>
                </TooltipTrigger>
                <TooltipContent>
                  <p>{t("attendees.open_filters")}</p>
                </TooltipContent>
              </Tooltip>
              <DialogContent className="bg-white">
                <DialogHeader>
                  <DialogTitle>{t("attendees.filters")}</DialogTitle>
                </DialogHeader>
                <div className="flex flex-col gap-6">
                  <div className="flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-sm font-medium">
                        {t("attendees.brings_kids")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t("attendees.toggle_kids")}
                      </span>
                    </div>
                    <Switch
                      checked={bringsKids ?? false}
                      onCheckedChange={(v: boolean) => setBringsKids(v)}
                      aria-label="Toggle brings kids filter"
                    />
                  </div>

                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-medium">
                      {t("attendees.weeks_coming")}
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {[1, 2, 3, 4].map((week) => {
                        const isActive = selectedWeeks.includes(week)
                        return (
                          <Button
                            key={week}
                            variant={isActive ? "default" : "outline"}
                            className={
                              isActive
                                ? "bg-primary text-white"
                                : "bg-white text-black"
                            }
                            aria-pressed={isActive}
                            onClick={() => handleToggleWeek(week)}
                          >
                            {t("attendees.week", { week })}
                          </Button>
                        )
                      })}
                    </div>
                  </div>

                  <div className="flex justify-between gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        clearFilters()
                        setFiltersOpen(false)
                      }}
                    >
                      {t("attendees.clear_filters")}
                    </Button>
                    <Button
                      onClick={() => {
                        applyFilters()
                        setFiltersOpen(false)
                      }}
                    >
                      {t("attendees.apply_filters")}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  aria-label="Export attendees as CSV"
                  className="bg-white text-black hover:bg-white hover:shadow-md"
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
