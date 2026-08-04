const TERMINAL_STATUSES = new Set(["accepted", "rejected"])

/**
 * Tri-state redirect guard for the application form page (rel-002
 * correction). `needsFlowChoice` is `null` until the popup's sales flows
 * have resolved — only an explicit `false` (single/zero-flow popup) makes a
 * terminal `application.status` unambiguous enough to redirect on. `true`
 * (multi-flow popup) must let FlowPicker mount instead, and `null` must
 * never redirect while still unresolved.
 *
 * Pure and side-effect free so both the page's redirect effect and its
 * render-time loader guard can share one strict-equality check instead of
 * drifting apart (read-006 in spirit — one source of truth for the gate).
 */
export function shouldRedirectToStatus(
  needsFlowChoice: boolean | null,
  status: string | null | undefined,
): boolean {
  return (
    needsFlowChoice === false && status != null && TERMINAL_STATUSES.has(status)
  )
}
