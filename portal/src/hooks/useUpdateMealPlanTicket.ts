import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { AttendeesService, type AttendeeTicketMetadataUpdate } from "@/client"
import { queryKeys } from "@/lib/query-keys"
import { useCityProvider } from "@/providers/cityProvider"

interface UpdateMealPlanTicketVars {
  attendeeId: string
  ticketId: string
  body: AttendeeTicketMetadataUpdate
}

/**
 * Edits a purchased meal-plan ticket's choices (daily_choices,
 * dietary_restriction, special_request) for the active popup.
 *
 * Calls PATCH /attendees/my/popup/{popup_id}/{attendee_id}/tickets/{ticket_id}/meal-plan
 * (AttendeesService.updateMyMealPlanTicket). On success it invalidates the same
 * passes subset the purchase flow does so Your Passes reflects the new choices,
 * and surfaces a toast on success/error.
 *
 * No-op (returns undefined) when no city context is available.
 */
export function useUpdateMealPlanTicket() {
  const { getCity } = useCityProvider()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async ({
      attendeeId,
      ticketId,
      body,
    }: UpdateMealPlanTicketVars) => {
      const city = getCity()
      return AttendeesService.updateMyMealPlanTicket({
        popupId: String(city!.id),
        attendeeId,
        ticketId,
        requestBody: body,
      })
    },
    onSuccess: () => {
      const city = getCity()
      if (city) {
        const popupId = String(city.id)
        queryClient.invalidateQueries({
          queryKey: queryKeys.purchases.byPopup(popupId),
        })
        queryClient.invalidateQueries({
          queryKey: queryKeys.attendees.byHumanPopup(popupId),
        })
      }
      toast.success("Meal plan updated")
    },
    onError: (error) => {
      console.error("Meal plan update failed:", error)
      toast.error("Could not update the meal plan. Please try again.")
    },
  })

  const updateMealPlanTicket = async (vars: UpdateMealPlanTicketVars) => {
    const city = getCity()
    if (!city) return
    return mutation.mutateAsync(vars)
  }

  return {
    updateMealPlanTicket,
    isPending: mutation.isPending,
  }
}

export default useUpdateMealPlanTicket
