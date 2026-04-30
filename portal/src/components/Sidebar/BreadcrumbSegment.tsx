import { Loader2 } from "lucide-react"
import Link from "next/link"
import { useTranslation } from "react-i18next"
import {
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
} from "../ui/breadcrumb"

interface BreadcrumbSegmentProps {
  path: string
  href?: string
  isCurrent?: boolean
  isLoading?: boolean
  nameMapping?: Record<string, string>
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
  href,
  isCurrent,
  isLoading,
  nameMapping,
}: BreadcrumbSegmentProps) => {
  const { t } = useTranslation()
  const isMappedId = nameMapping && Object.keys(nameMapping).includes(path)
  const translationKey = KNOWN_SEGMENTS[path]
  const displayText = isMappedId
    ? nameMapping[path]
    : translationKey
      ? t(translationKey)
      : path

  const formattedText =
    typeof displayText === "string"
      ? displayText.charAt(0).toUpperCase() + displayText.slice(1)
      : displayText

  // Mapping still resolving: show a spinner, no link.
  if (isLoading && isMappedId) {
    return (
      <BreadcrumbItem>
        <div className="flex items-center">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          <BreadcrumbLink>{t("common.loading")}</BreadcrumbLink>
        </div>
      </BreadcrumbItem>
    )
  }

  // Last segment is the current page — non-clickable by convention.
  if (isCurrent || !href) {
    return (
      <BreadcrumbItem>
        <BreadcrumbPage>{formattedText}</BreadcrumbPage>
      </BreadcrumbItem>
    )
  }

  return (
    <BreadcrumbItem>
      <BreadcrumbLink asChild>
        <Link href={href}>{formattedText}</Link>
      </BreadcrumbLink>
    </BreadcrumbItem>
  )
}

export default BreadcrumbSegment
