import { ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import { usePreview } from "./PreviewContext"
import { makeIsHl, ringIf } from "./ring"

// Replica del bottom bar flotante del checkout: botón "Volver" con flecha a la
// izquierda, total en el medio y botón "Continuar" a la derecha.
export function PreviewCheckoutBottomBar() {
  const { highlightedKeys } = usePreview()
  const isHl = makeIsHl(highlightedKeys)

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-2xl px-3 py-3 shadow-2xl",
        ringIf(isHl("checkout_bottom_bar_bg_color")),
      )}
      style={{
        backgroundColor: "var(--checkout-bottom-bar-bg)",
        borderRadius: "calc(var(--radius) + 8px)",
      }}
    >
      <button
        type="button"
        tabIndex={-1}
        className={cn(
          "inline-flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium opacity-70",
          ringIf(isHl("checkout_bottom_bar_text_color")),
        )}
        style={{ color: "var(--checkout-bottom-bar-text)" }}
      >
        <ArrowLeft className="size-3.5" />
        Back
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <span
          className={cn(
            "text-[10px] font-medium uppercase tracking-wider opacity-60",
            ringIf(isHl("checkout_bottom_bar_text_color")),
          )}
          style={{ color: "var(--checkout-bottom-bar-text)" }}
        >
          Total
        </span>
        <span
          className={cn(
            "text-xl font-bold",
            ringIf(isHl("checkout_bottom_bar_text_color")),
          )}
          style={{ color: "var(--checkout-bottom-bar-text)" }}
        >
          $40.000
        </span>
      </div>
      <button
        type="button"
        tabIndex={-1}
        className={cn(
          "inline-flex shrink-0 items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold shadow-lg",
          ringIf(isHl("checkout_button_color", "checkout_button_title_color")),
        )}
        style={{
          backgroundColor: "var(--checkout-button)",
          color: "var(--checkout-button-title)",
          borderRadius: "var(--radius)",
        }}
      >
        Continue
      </button>
    </div>
  )
}
