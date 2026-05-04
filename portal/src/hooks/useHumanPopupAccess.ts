import { useQuery } from "@tanstack/react-query"
import { PortalService } from "@/client"
import { queryKeys } from "@/lib/query-keys"

/**
 * Application status subset exposed through the access response.
 * Mirrors the backend `PopupAccessResponse.application_status` field.
 */
export type ApplicationStatus =
  | "accepted"
  | "submitted"
  | "in review"
  | "rejected"

/**
 * Tristate return type for the popup access gate.
 *
 * - `loading` — backend request in flight; caller should render a loader.
 * - `allowed` — Human has access; `source` indicates which ladder step matched.
 * - `denied` — Human does not have access; `reason` indicates why.
 *
 * The hook does NOT redirect. Routing decisions live in the page component.
 */
export type HumanPopupAccess =
  | { state: "loading" }
  | {
      state: "denied"
      reason: "no_access" | "application_pending" | "application_rejected"
    }
  | {
      state: "allowed"
      source: "application" | "attendee" | "payment" | "companion"
      applicationStatus?: ApplicationStatus
    }

/**
 * Resolves portal access for the current Human against a specific popup.
 *
 * Calls `GET /portal/popup/{popup_id}/access` which runs the 7-step access
 * ladder on the backend (accepted application → attendee → payment →
 * companion → denied).
 *
 * The hook does NOT perform any redirect or side effect. Consumers read the
 * tristate result and handle navigation accordingly.
 *
 * On network error the hook falls back to `{ state: "denied", reason: "no_access" }`
 * to avoid infinite loading states.
 */
export function useHumanPopupAccess(
  popupId: string | null | undefined,
): HumanPopupAccess {
  const { data, isLoading, isError } = useQuery({
    queryKey: queryKeys.humanPopupAccess.byPopup(popupId ?? ""),
    queryFn: async () => {
      return PortalService.getPopupAccess({ popupId: popupId! })
    },
    enabled: popupId != null && popupId !== "",
    // Treat errors as denied rather than surfacing them to the UI
    retry: 1,
  })

  if (!popupId || isLoading) {
    return { state: "loading" }
  }

  if (isError || !data) {
    return { state: "denied", reason: "no_access" }
  }

  if (!data.allowed) {
    const reason =
      data.reason === "application_pending"
        ? "application_pending"
        : data.reason === "application_rejected"
          ? "application_rejected"
          : "no_access"
    return { state: "denied", reason }
  }

  // data.allowed === true — source is guaranteed non-null by the backend ladder
  const source = (data.source ?? "attendee") as
    | "application"
    | "attendee"
    | "payment"
    | "companion"

  const applicationStatus =
    data.application_status != null
      ? (data.application_status as ApplicationStatus)
      : undefined

  return { state: "allowed", source, applicationStatus }
}

export default useHumanPopupAccess
