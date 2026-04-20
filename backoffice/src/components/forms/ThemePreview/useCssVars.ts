import { useMemo } from "react"
import { PORTAL_DEFAULT_VARS } from "./constants"
import { expandThemeColors } from "./themeExpand"

export function useCssVars(
  colors: Record<string, string>,
  radius: string,
  borderRadius: string,
) {
  return useMemo(() => {
    const styles: Record<string, string> = {
      ...PORTAL_DEFAULT_VARS,
      ...expandThemeColors(colors),
    }
    if (radius) styles["--radius"] = radius
    if (borderRadius) styles["--border-radius"] = borderRadius
    return styles
  }, [colors, radius, borderRadius])
}
