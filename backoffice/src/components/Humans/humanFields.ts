import type { HumanRating } from "@/client"

export const GENDER_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "non_binary", label: "Non Binary" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
]

export const AGE_OPTIONS = [
  { value: "under_18", label: "Under 18" },
  { value: "18_24", label: "18-24" },
  { value: "25_34", label: "25-34" },
  { value: "35_44", label: "35-44" },
  { value: "45_54", label: "45-54" },
  { value: "55_plus", label: "55+" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
]

export type RatingBadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline"

export const RATING_OPTIONS: {
  value: HumanRating
  label: string
  description: string
  badge: RatingBadgeVariant
}[] = [
  {
    value: "unrated",
    label: "No rating",
    description: "No assessment yet",
    badge: "secondary",
  },
  {
    value: "red_flag",
    label: "🔴 Red Flag",
    description: "Should not be admitted to gatherings (blocks the user)",
    badge: "destructive",
  },
  {
    value: "orange_flag",
    label: "🟠 Orange Flag",
    description: "Reasons against, still open to discussion",
    badge: "outline",
  },
  {
    value: "green_flag",
    label: "🟢 Green Flag",
    description: "A great attendee who adds value",
    badge: "default",
  },
  {
    value: "star",
    label: "⭐ Star",
    description: "Excellent — their presence enriches everyone's experience",
    badge: "default",
  },
]

export function ratingMeta(rating: HumanRating | string | null | undefined) {
  return RATING_OPTIONS.find((o) => o.value === rating) ?? RATING_OPTIONS[0]
}
