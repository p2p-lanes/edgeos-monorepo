import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "../ui/button"

interface PaginationProps {
  currentPage: number
  totalPages: number
  onPageChange: (page: number) => void
}

const Pagination = ({
  currentPage,
  totalPages,
  onPageChange,
}: PaginationProps) => {
  const { t } = useTranslation()

  const goToPage = (page: number) => {
    // Clamp to the valid range so navigation can never produce a page < 1,
    // which would send a negative skip to the API and 422.
    onPageChange(Math.min(Math.max(page, 1), Math.max(totalPages, 1)))
  }

  return (
    <div className="flex justify-center items-center gap-2 mt-8 py-2">
      <Button
        onClick={() => goToPage(currentPage - 1)}
        disabled={currentPage <= 1}
        variant="outline"
        aria-label={t("common.previous_page")}
      >
        <ChevronLeftIcon className="w-4 h-4" />
      </Button>
      <span className="text-sm font-medium px-2">
        {t("common.page_of", { current: currentPage, total: totalPages })}
      </span>
      <Button
        onClick={() => goToPage(currentPage + 1)}
        disabled={currentPage >= totalPages}
        aria-label={t("common.next_page")}
        variant="outline"
      >
        <ChevronRightIcon className="w-4 h-4" />
      </Button>
    </div>
  )
}

export default Pagination
