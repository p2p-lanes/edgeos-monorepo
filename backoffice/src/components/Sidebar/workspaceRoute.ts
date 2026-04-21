const EDIT_ROUTE_PATTERN = /\/(new|edit)(\/|$)/
const TICKETING_STEP_EDIT_ROUTE_PATTERN = /^\/ticketing-steps\/[^/]+\/?$/

export function isWorkspaceExitRoute(pathname: string): boolean {
  return (
    EDIT_ROUTE_PATTERN.test(pathname) ||
    TICKETING_STEP_EDIT_ROUTE_PATTERN.test(pathname)
  )
}

export function getWorkspaceFallbackPath(pathname: string): string {
  return pathname.replace(/\/[^/]+(\/edit)?$/, "") || "/"
}
