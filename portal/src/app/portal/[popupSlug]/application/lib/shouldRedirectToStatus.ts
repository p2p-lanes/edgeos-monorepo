const TERMINAL_STATUSES = new Set(["accepted", "rejected"])

/**
 * Whether the form should hand back to the status page.
 *
 * It used to take a `needsFlowChoice` tri-state as well, because the
 * application it was asked about was resolved by human and gathering and
 * so might belong to a different way in — redirecting on it could send
 * someone away from a door they had not applied through yet.
 *
 * The caller resolves the application for the door being looked at now
 * (sdd/sales-flows-rediseno), so it either belongs here or is null. A
 * terminal status is a terminal status, and there is nothing left to
 * qualify it with.
 *
 * Pure and side-effect free so the page's redirect effect and its
 * render-time loader guard share one check instead of drifting apart.
 */
export function shouldRedirectToStatus(
  status: string | null | undefined,
): boolean {
  return status != null && TERMINAL_STATUSES.has(status)
}
