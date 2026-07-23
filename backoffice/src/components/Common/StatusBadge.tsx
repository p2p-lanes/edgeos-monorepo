import { Badge } from "@/components/ui/badge"

type StatusVariant = "default" | "secondary" | "destructive" | "outline"

const statusMap: Record<
  string,
  { variant: StatusVariant; label?: string; className?: string }
> = {
  accepted: { variant: "default" },
  approved: { variant: "default" },
  active: { variant: "default" },
  "in review": { variant: "secondary" },
  pending: { variant: "secondary" },
  pending_fee: {
    variant: "outline",
    label: "Pending Fee",
    className: "bg-warning-soft text-warning border-warning/25",
  },
  inactive: { variant: "secondary" },
  draft: { variant: "outline" },
  none: { variant: "outline", label: "None" },
  rejected: { variant: "destructive" },
  expired: { variant: "destructive" },
  cancelled: { variant: "destructive" },
  flagged: { variant: "destructive" },
  deleted: { variant: "destructive" },
  // Human rating levels
  unrated: { variant: "outline", label: "No rating" },
  red_flag: { variant: "destructive", label: "🔴 Red Flag" },
  orange_flag: {
    variant: "outline",
    label: "🟠 Orange Flag",
    className: "bg-warning-soft text-warning border-warning/25",
  },
  green_flag: {
    variant: "outline",
    label: "🟢 Green Flag",
    className: "bg-success-soft text-success border-success/25",
  },
  star: {
    variant: "outline",
    label: "⭐ Star",
    className: "bg-info-soft text-info border-info/25",
  },
  ambassador: { variant: "default" },
  regular: { variant: "outline" },
  strong_yes: { variant: "default", label: "Strong Yes" },
  yes: { variant: "default", label: "Yes" },
  no: { variant: "destructive", label: "No" },
  strong_no: { variant: "destructive", label: "Strong No" },
}

interface StatusBadgeProps {
  status: string
  className?: string
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const normalized = status.toLowerCase()
  if (normalized === "withdrawn") return null

  const config = statusMap[normalized] ?? {
    variant: "outline" as StatusVariant,
  }
  const label = config.label ?? status

  return (
    <Badge
      variant={config.variant}
      className={
        config.className
          ? `${config.className} ${className ?? ""}`.trim()
          : className
      }
    >
      {label}
    </Badge>
  )
}

export function getStatusVariant(status: string): StatusVariant {
  const normalized = status.toLowerCase()
  return statusMap[normalized]?.variant ?? "outline"
}
