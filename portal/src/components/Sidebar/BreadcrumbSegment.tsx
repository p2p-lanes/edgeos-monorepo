import { Loader2 } from "lucide-react"
import Link from "next/link"
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
  groupMapping?: Record<string, string>
}

const BreadcrumbSegment = ({
  path,
  href,
  isCurrent,
  isLoading,
  groupMapping,
}: BreadcrumbSegmentProps) => {
  const isGroupId = groupMapping && Object.keys(groupMapping).includes(path)
  const displayText = isGroupId ? groupMapping[path] : path

  const formattedText =
    typeof displayText === "string"
      ? displayText.charAt(0).toUpperCase() + displayText.slice(1)
      : displayText

  // Groups still resolving: show a spinner, no link.
  if (isLoading && isGroupId) {
    return (
      <BreadcrumbItem>
        <div className="flex items-center">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          <BreadcrumbLink>Cargando...</BreadcrumbLink>
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
