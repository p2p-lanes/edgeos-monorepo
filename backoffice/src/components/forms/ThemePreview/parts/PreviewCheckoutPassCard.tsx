import { cn } from "@/lib/utils"
import { usePreview } from "./PreviewContext"
import { makeIsHl, ringIf } from "./ring"

interface PreviewCheckoutPassCardProps {
  title: string
  description: string
  price: string
  selected?: boolean
}

// Replica de una card de pase en el checkout. El estado "selected" usa los
// colores del botón activo (checkout_button_color / title), mientras que las
// cards no seleccionadas muestran las disabled variants derivadas por
// color-mix. Los estados semánticos (success/error/warning) no se teme-mizan
// en esta iteración.
export function PreviewCheckoutPassCard({
  title,
  description,
  price,
  selected,
}: PreviewCheckoutPassCardProps) {
  const { highlightedKeys } = usePreview()
  const isHl = makeIsHl(highlightedKeys)

  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 rounded-xl p-4 shadow-sm",
        ringIf(isHl("checkout_card_bg_color")),
      )}
      style={{
        backgroundColor: "var(--checkout-card-bg)",
        borderRadius: "calc(var(--radius) + 4px)",
      }}
    >
      <div className="flex min-w-0 flex-col">
        <span
          className={cn(
            "text-base font-semibold",
            ringIf(isHl("checkout_title_color")),
          )}
          style={{ color: "var(--checkout-title)" }}
        >
          {title}
        </span>
        <span
          className={cn(
            "mt-1 text-xs",
            ringIf(isHl("checkout_subtitle_color")),
          )}
          style={{ color: "var(--checkout-subtitle)" }}
        >
          {description}
        </span>
        <span
          className={cn(
            "mt-2 text-sm font-bold",
            ringIf(isHl("checkout_title_color")),
          )}
          style={{ color: "var(--checkout-title)" }}
        >
          {price}
        </span>
      </div>
      <button
        type="button"
        tabIndex={-1}
        className={cn(
          "shrink-0 rounded-lg px-3 py-1.5 text-xs font-semibold",
          ringIf(isHl("checkout_button_color", "checkout_button_title_color")),
        )}
        style={
          selected
            ? {
                backgroundColor: "var(--checkout-button)",
                color: "var(--checkout-button-title)",
                borderRadius: "var(--radius)",
              }
            : {
                backgroundColor: "var(--checkout-button-disabled)",
                color: "var(--checkout-button-title-disabled)",
                borderRadius: "var(--radius)",
              }
        }
      >
        {selected ? "Agregado" : "Agregar"}
      </button>
    </div>
  )
}
