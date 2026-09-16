/**
 * Removes repeated API rows only when they share the authoritative physical
 * ticket identity. Distinct ticket IDs must remain distinct even when they
 * reference the same product, payment, or metadata.
 */
export function dedupTicketEntries<T extends { id: string }>(
  entries: T[],
): T[] {
  if (entries.length === 0) return entries

  const seenIds = new Set<string>()
  return entries.filter((entry) => {
    if (seenIds.has(entry.id)) return false
    seenIds.add(entry.id)
    return true
  })
}
