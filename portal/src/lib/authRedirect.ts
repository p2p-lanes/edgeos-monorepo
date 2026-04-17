const AUTH_REDIRECT_STORAGE_KEY = "portal_auth_redirect"

const isValidAuthRedirect = (value: string | null): value is string => {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/auth")
  )
}

export const saveAuthRedirect = (path: string) => {
  if (typeof window === "undefined") return
  if (!isValidAuthRedirect(path)) return

  window.sessionStorage.setItem(AUTH_REDIRECT_STORAGE_KEY, path)
}

export const consumeAuthRedirect = (fallback = "/portal") => {
  if (typeof window === "undefined") return fallback

  const storedPath = window.sessionStorage.getItem(AUTH_REDIRECT_STORAGE_KEY)
  window.sessionStorage.removeItem(AUTH_REDIRECT_STORAGE_KEY)

  return isValidAuthRedirect(storedPath) ? storedPath : fallback
}
