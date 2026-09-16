/**
 * Where the form hands someone whose application is already resolved.
 *
 * Both terminal statuses used to land on the gathering home. For an
 * acceptance that made the person answer "which way in?" a second time,
 * having just arrived from the very door card that asked it — and the home
 * is a chooser, not an answer.
 *
 * An acceptance goes to that door's passes. A rejection has no passes to
 * show, so it keeps the home, where the door card says what happened. An
 * accepted application with no flow on it predates the re-key and has no
 * door to name, so it keeps the home too.
 *
 * Pure and side-effect free, like `shouldRedirectToStatus` beside it, so the
 * page's effect and its tests share one answer.
 */
export function resolvedApplicationDestination(
  popupSlug: string | null | undefined,
  application: { status?: string | null; sales_flow_id?: string | null },
): string {
  const home = `/portal/${popupSlug}`
  if (application.status !== "accepted" || !application.sales_flow_id) {
    return home
  }
  return `${home}/passes?flow=${application.sales_flow_id}`
}
