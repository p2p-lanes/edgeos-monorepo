export function getSafeReturnTo(value: string | null | undefined) {
  if (!value || !value.startsWith("/")) return null
  if (value.startsWith("//")) return null
  try {
    const url = new URL(value, "http://internal.local")
    if (url.origin !== "http://internal.local") return null
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return null
  }
}

/** Build an auth URL that returns to the requested internal page after login. */
export function getAuthRedirectPath(returnTo: string | null | undefined) {
  const safeReturnTo = getSafeReturnTo(returnTo)

  // Never point the auth page back at itself. Besides being unnecessary, this
  // can create a redirect loop when a login request itself returns 401.
  if (
    !safeReturnTo ||
    safeReturnTo === "/auth" ||
    safeReturnTo.startsWith("/auth?") ||
    safeReturnTo.startsWith("/auth#") ||
    safeReturnTo.startsWith("/auth/")
  ) {
    return "/auth"
  }

  return `/auth?redirect=${encodeURIComponent(safeReturnTo)}`
}
