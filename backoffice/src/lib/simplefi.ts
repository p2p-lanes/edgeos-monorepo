export function normalizeSimpleFiApiKey(value: string): string {
  return value
    .trim()
    .replace(/^Bearer\s+/i, "")
    .trim()
}
