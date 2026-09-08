/** Move a legacy checkout URL without discarding payment, restore, or attribution context. */
export function canonicalShopTarget(
  popupSlug: string,
  flowSlug: string | null,
  search = "",
  hash = "",
) {
  const params = new URLSearchParams(search)
  params.delete("flow")
  const query = params.toString()
  return `/portal/${popupSlug}/shop${flowSlug ? `/${flowSlug}` : ""}${query ? `?${query}` : ""}${hash}`
}

export function isFlowUuid(identifier: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    identifier,
  )
}
