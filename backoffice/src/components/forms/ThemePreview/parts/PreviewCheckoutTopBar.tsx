import { cn } from "@/lib/utils"
import { usePreview } from "./PreviewContext"
import { makeIsHl, ringIf } from "./ring"

// Replica del navbar sticky del checkout real. Muestra la label del step
// actual a la izquierda y un badge/pill con el número del step a la derecha.
export function PreviewCheckoutTopBar() {
  const { highlightedKeys } = usePreview()
  const isHl = makeIsHl(highlightedKeys)

  return (
    <div
      className={cn(
        "sticky top-0 z-20 backdrop-blur-md",
        ringIf(isHl("checkout_navbar_bg_color")),
      )}
      style={{ backgroundColor: "var(--checkout-navbar-bg)" }}
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
        <span
          className={cn(
            "text-sm font-semibold",
            ringIf(isHl("checkout_title_color")),
          )}
          style={{ color: "var(--checkout-title)" }}
        >
          Pases
        </span>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-3 py-1 text-[11px] font-semibold",
            ringIf(
              isHl("checkout_badge_bg_color", "checkout_badge_title_color"),
            ),
          )}
          style={{
            backgroundColor: "var(--checkout-badge-bg)",
            color: "var(--checkout-badge-title)",
          }}
        >
          Paso 1 de 4
        </span>
      </div>
    </div>
  )
}
