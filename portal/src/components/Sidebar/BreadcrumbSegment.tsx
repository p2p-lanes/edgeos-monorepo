import { Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { BreadcrumbItem, BreadcrumbLink } from "../ui/breadcrumb"

interface BreadcrumbSegmentProps {
  path: string
  isLoading?: boolean
  groupMapping?: Record<string, string>
}

const KNOWN_SEGMENTS: Record<string, string> = {
  application: "breadcrumbs.application",
  passes: "breadcrumbs.passes",
  buy: "breadcrumbs.buy",
  attendees: "breadcrumbs.attendees",
  groups: "breadcrumbs.groups",
  profile: "breadcrumbs.profile",
}

const BreadcrumbSegment = ({
  path,
  isLoading,
  groupMapping,
}: BreadcrumbSegmentProps) => {
  const { t } = useTranslation()
  // Verificar si este path corresponde a un ID de grupo y tenemos un mapping para él
  const isGroupId = groupMapping && Object.keys(groupMapping).includes(path)
  const translationKey = KNOWN_SEGMENTS[path]
  const displayText = isGroupId
    ? groupMapping[path]
    : translationKey
      ? t(translationKey)
      : path

  // Capitalizar primera letra
  const formattedText =
    typeof displayText === "string"
      ? displayText.charAt(0).toUpperCase() + displayText.slice(1)
      : displayText

  return (
    <BreadcrumbItem>
      {isLoading && isGroupId ? (
        <div className="flex items-center">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          <BreadcrumbLink>{t("common.loading")}</BreadcrumbLink>
        </div>
      ) : (
        <BreadcrumbLink>{formattedText}</BreadcrumbLink>
      )}
    </BreadcrumbItem>
  )
}

export default BreadcrumbSegment
