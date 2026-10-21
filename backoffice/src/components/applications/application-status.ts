import type { ApplicationStatus } from "@/client"

export const APPLICATION_STATUS_OPTIONS: {
  value: ApplicationStatus
  label: string
}[] = [
  { value: "draft", label: "Draft" },
  { value: "pending_fee", label: "Pending Fee" },
  { value: "in review", label: "In Review" },
  { value: "accepted", label: "Accepted" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
]
