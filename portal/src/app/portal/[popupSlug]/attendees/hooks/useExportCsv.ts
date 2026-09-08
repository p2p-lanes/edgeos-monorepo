"use client"

import { useCallback, useState } from "react"
import { toast } from "sonner"
import { portalFetch } from "@/lib/session-network"
import { useCityProvider } from "@/providers/cityProvider"

type UseExportCsvReturn = {
  isExporting: boolean
  handleExportCsv: () => Promise<void>
}

const useExportCsv = (): UseExportCsvReturn => {
  const { getCity } = useCityProvider()
  const [isExporting, setIsExporting] = useState(false)

  const handleExportCsv = useCallback(async (): Promise<void> => {
    const city = getCity()
    if (!city?.id) {
      toast.error("City not found. Please try again later.")
      return
    }
    if (city.takes_applications === false || !city.show_attendee_directory) {
      return
    }

    const dismissId = toast.loading("Preparing CSV export...")
    setIsExporting(true)
    try {
      const response = await portalFetch(
        `/api/v1/applications/my/directory/${city.id}/csv`,
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const blob = await response.blob()
      const blobUrl = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = blobUrl
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-")
      link.download = `attendees-${city.name ?? "city"}-${timestamp}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(blobUrl)

      toast.success("CSV downloaded successfully", { id: dismissId })
    } catch (error: unknown) {
      console.error("Error exporting CSV:", error)
      toast.error("Failed to download CSV. Please try again.", {
        id: dismissId,
      })
    } finally {
      setIsExporting(false)
    }
  }, [getCity])

  return { isExporting, handleExportCsv }
}

export default useExportCsv
