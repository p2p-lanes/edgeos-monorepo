import { cn } from "@/lib/utils"
import { usePreview } from "./PreviewContext"
import { makeIsHl, ringIf } from "./ring"

// Replica del bottom bar flotante del checkout: muestra el total a la izquierda
// (texto claro sobre el fondo oscuro del bar) y el botón "Continuar" a la
// derecha.
export function PreviewCheckoutBottomBar() {
  const { highlightedKeys } = usePreview()
  const isHl = makeIsHl(highlightedKeys)

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 rounded-2xl px-5 py-3 shadow-2xl",
        ringIf(isHl("checkout_bottom_bar_bg_color")),
      )}
      style={{
        backgroundColor: "var(--checkout-bottom-bar-bg)",
        borderRadius: "calc(var(--radius) + 8px)",
      }}
    >
      <div className="flex flex-col">
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
          "inline-flex items-center justify-center rounded-xl px-5 py-2.5 text-sm font-semibold shadow-lg",
          ringIf(isHl("checkout_button_color", "checkout_button_title_color")),
        )}
        style={{
          backgroundColor: "var(--checkout-button)",
          color: "var(--checkout-button-title)",
          borderRadius: "var(--radius)",
        }}
      >
        Continuar
      </button>
    </div>
  )
}
