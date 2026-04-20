import { LEGACY_HIGHLIGHT_FROM_NEW } from "../themeExpand"

export function ringIf(active: boolean): string {
  return active
    ? "outline outline-2 outline-blue-500 outline-offset-2 rounded-sm"
    : ""
}

// Resuelve highlight cruzado: los componentes del preview chequean por las
// keys legacy (ej. "heading", "primary"), pero el usuario puede estar
// hovereando una key nueva (ej. "title_color"). Este helper hace que el
// hover sobre la key nueva también ilumine los componentes asociados.
export function makeIsHl(highlightedKeys: Set<string>) {
  return (...keys: string[]) =>
    keys.some((k) => {
      if (highlightedKeys.has(k)) return true
      const newKeys = LEGACY_HIGHLIGHT_FROM_NEW[k]
      return !!newKeys && newKeys.some((nk) => highlightedKeys.has(nk))
    })
}
