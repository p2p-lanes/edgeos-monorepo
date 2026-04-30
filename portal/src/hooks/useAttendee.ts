import { useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { AttendeesService } from "@/client"
import { queryKeys } from "@/lib/query-keys"
import { useCityProvider } from "@/providers/cityProvider"
import type { CreateAttendee } from "@/types/Attendee"
import useAuth from "./useAuth"

const handleNetworkError = (error: unknown) => {
  console.error("Attendee operation failed:", error)
  if (error instanceof TypeError && error.message.includes("fetch")) {
    toast.error("Network error. Please check your connection and try again.")
  } else if (error instanceof Error && error.name === "AbortError") {
    toast.error("Request timeout. Please try again.")
  } else {
    toast.error("Something went wrong. Please try again.")
  }
}

/**
 * Provides add/remove/edit mutations for companion attendees on the passes page.
 *
 * All mutations call the human-scoped endpoints:
 * - POST   /attendees/my/popup/{popup_id}
 * - PATCH  /attendees/my/popup/{popup_id}/{attendee_id}
 * - DELETE /attendees/my/popup/{popup_id}/{attendee_id}
 *
 * On success, the attendees query cache for the popup is invalidated so
 * `useHumanAttendeesQuery` refetches the updated list.
 *
 * Guard condition: all mutation functions are no-ops when `currentHuman` or
 * `city` context is not available. The guard no longer checks for an
 * Application — the hook is usable for any popup the Human has access to.
 *
 * The POST endpoint returns 422 `application_required` for direct-sale popups
 * as a backend defense-in-depth measure. The portal hides the Add buttons for
 * direct-sale Humans (CAP-L), so this path is unreachable in normal flow.
 */
const useAttendee = () => {
  const { getCity } = useCityProvider()
  const { user: currentHuman } = useAuth()
  const queryClient = useQueryClient()

  const addMutation = useMutation({
    mutationFn: async (data: CreateAttendee) => {
      const city = getCity()
      return AttendeesService.createMyAttendeeForPopup({
        popupId: String(city!.id),
        requestBody: {
          name: data.name,
          email: data.email,
          category: data.category,
          gender: data.gender,
        },
      })
    },
    onSuccess: (_result, _vars) => {
      const city = getCity()
      if (city) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.attendees.byHumanPopup(String(city.id)),
        })
      }
    },
    onError: handleNetworkError,
  })

  const removeMutation = useMutation({
    mutationFn: async (attendeeId: string) => {
      const city = getCity()
      return AttendeesService.deleteMyAttendeeForPopup({
        popupId: String(city!.id),
        attendeeId,
      })
    },
    onSuccess: (_result, _vars) => {
      const city = getCity()
      if (city) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.attendees.byHumanPopup(String(city.id)),
        })
      }
    },
    onError: handleNetworkError,
  })

  const editMutation = useMutation({
    mutationFn: async ({
      attendeeId,
      data,
    }: {
      attendeeId: string
      data: CreateAttendee
    }) => {
      const city = getCity()
      return AttendeesService.updateMyAttendeeForPopup({
        popupId: String(city!.id),
        attendeeId,
        requestBody: {
          name: data.name,
          email: data.email,
          gender: data.gender,
        },
      })
    },
    onSuccess: (_result, _vars) => {
      const city = getCity()
      if (city) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.attendees.byHumanPopup(String(city.id)),
        })
      }
    },
    onError: handleNetworkError,
  })

  const addAttendee = async (data: CreateAttendee) => {
    const city = getCity()
    // Guard: requires authenticated human and city context.
    // Application presence is no longer required — the endpoint handles
    // the application_required check on the backend for non-application popups.
    if (!currentHuman || !city) return
    return addMutation.mutateAsync(data)
  }

  const removeAttendee = async (attendeeId: string) => {
    const city = getCity()
    if (!currentHuman || !city) return
    return removeMutation.mutateAsync(attendeeId)
  }

  const editAttendee = async (attendeeId: string, data: CreateAttendee) => {
    const city = getCity()
    if (!currentHuman || !city) return
    return editMutation.mutateAsync({ attendeeId, data })
  }

  return {
    loading:
      addMutation.isPending ||
      removeMutation.isPending ||
      editMutation.isPending,
    addAttendee,
    removeAttendee,
    editAttendee,
  }
}
export default useAttendee
