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
