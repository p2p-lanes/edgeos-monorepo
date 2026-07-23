import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"

import {
  type ApiError,
  type HumanPublic,
  type HumanRating,
  HumansService,
} from "@/client"
import { RATING_OPTIONS, ratingMeta } from "@/components/Humans/humanFields"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

/**
 * Inline rating control. Rating is a frequent, standalone admin action, so it
 * auto-saves on change (its own PATCH) instead of living inside the profile
 * edit form — the assessment stays one click away, next to the comments.
 */
export function HumanRatingControl({ human }: { human: HumanPublic }) {
  const { isAdmin } = useAuth()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const current = (human.rating ?? "unrated") as HumanRating
  const [value, setValue] = useState<HumanRating>(current)

  // Keep the local value in sync if the human is refetched elsewhere.
  useEffect(() => {
    setValue(current)
  }, [current])

  const mutation = useMutation({
    mutationFn: (rating: HumanRating) =>
      HumansService.updateHuman({
        humanId: human.id,
        requestBody: { rating },
      }),
    onSuccess: () => {
      showSuccessToast("Rating updated")
      queryClient.invalidateQueries({ queryKey: ["humans"] })
      queryClient.invalidateQueries({ queryKey: ["humans", human.id] })
    },
    onError: (err) => {
      setValue(current)
      createErrorHandler(showErrorToast)(err as ApiError)
    },
  })

  return (
    <div className="space-y-1.5">
      <Select
        value={value}
        onValueChange={(next) => {
          const rating = next as HumanRating
          setValue(rating)
          mutation.mutate(rating)
        }}
        disabled={!isAdmin || mutation.isPending}
      >
        <SelectTrigger className="w-full sm:w-64">
          <SelectValue placeholder="Select a rating" />
        </SelectTrigger>
        <SelectContent>
          {RATING_OPTIONS.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-sm text-muted-foreground">
        {ratingMeta(value).description}
      </p>
    </div>
  )
}
