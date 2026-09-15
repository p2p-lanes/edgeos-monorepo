type ApplicationLike = {
  status?: string | null
}

type ParticipationLike = {
  type?: string | null
  application_status?: string | null
}

/**
 * Popup-wide approval used by shared community resources such as Events.
 *
 * A gathering can have multiple application flows. Selecting a flow changes
 * which application/checkout is on screen, but it must not revoke access to a
 * popup-wide resource when another application for the same popup is accepted.
 */
export function hasAcceptedPopupParticipation(
  applications: ApplicationLike[],
  participation: ParticipationLike | null | undefined,
): boolean {
  return (
    applications.some((application) => application.status === "accepted") ||
    (participation?.type === "companion" &&
      participation.application_status === "accepted")
  )
}
