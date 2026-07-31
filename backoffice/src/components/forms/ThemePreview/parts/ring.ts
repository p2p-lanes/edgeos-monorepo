import { LEGACY_HIGHLIGHT_FROM_NEW } from "../themeExpand"

export function ringIf(active: boolean): string {
  return active
    ? "outline outline-2 outline-blue-500 outline-offset-2 rounded-sm"
    : ""
}

// Resolves cross-highlighting: preview components check against the legacy
// keys (e.g. "heading", "primary"), but the user may be hovering a new key
// (e.g. "title_color"). This helper makes hovering the new key also light
// up the associated components.
export function makeIsHl(highlightedKeys: Set<string>) {
  return (...keys: string[]) =>
    keys.some((k) => {
      if (highlightedKeys.has(k)) return true
      const newKeys = LEGACY_HIGHLIGHT_FROM_NEW[k]
      return !!newKeys && newKeys.some((nk) => highlightedKeys.has(nk))
    })
}
