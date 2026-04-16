import { cn } from "@/lib/utils"
import { PreviewCheckoutBottomBar } from "../parts/PreviewCheckoutBottomBar"
import { PreviewCheckoutPassCard } from "../parts/PreviewCheckoutPassCard"
import { PreviewCheckoutTopBar } from "../parts/PreviewCheckoutTopBar"
import { useDisplayEvent, usePreview } from "../parts/PreviewContext"
import { makeIsHl, ringIf } from "../parts/ring"

// Gradient fallback cuando el popup no tiene express_checkout_background —
// mantiene el cosmic look del checkout real aunque el usuario no haya subido
// imagen todavía.
const FALLBACK_BG =
  "radial-gradient(ellipse at 30% 20%, #4c3a8a 0%, #1b1540 50%, #080618 100%)"

// Replica del flujo de Pases del checkout real: background image fullscreen,
// navbar sticky con step actual + badge, watermark grande "Pases",
// stack de cards, y bottom bar con total + CTA.
export function CheckoutView() {
  const { highlightedKeys, event } = usePreview()
  const display = useDisplayEvent()
  const isHl = makeIsHl(highlightedKeys)

  const backgroundImage = event.express_checkout_background
    ? `url(${event.express_checkout_background})`
    : FALLBACK_BG

  return (
    <div
      className="relative flex h-full flex-col"
      style={{
        backgroundImage,
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <PreviewCheckoutTopBar />

      <div className="flex-1 overflow-hidden px-6 pb-6 pt-8">
        <div className="relative mb-8">
          <div
            aria-hidden="true"
            className={cn(
              "pointer-events-none select-none whitespace-nowrap text-[5rem] font-black leading-none tracking-tight",
              ringIf(isHl("checkout_watermark_color")),
            )}
            style={{ color: "var(--checkout-watermark)" }}
          >
            Pases
          </div>
          <p
            className={cn(
              "mt-2 text-base",
              ringIf(isHl("checkout_subtitle_color")),
            )}
            style={{ color: "var(--checkout-subtitle)" }}
          >
            Elegí los pases que querés comprar para {display.name}.
          </p>
        </div>

        <div className="flex flex-col gap-3">
          {/* Attendee header card */}
          <div
            className={cn(
              "rounded-xl p-4 shadow-sm",
              ringIf(isHl("checkout_card_bg_color")),
            )}
            style={{
              backgroundColor: "var(--checkout-card-bg)",
              borderRadius: "calc(var(--radius) + 4px)",
            }}
          >
            <span
              className={cn(
                "block text-xs font-medium uppercase tracking-wider",
                ringIf(isHl("checkout_subtitle_color")),
              )}
              style={{ color: "var(--checkout-subtitle)" }}
            >
              Asistente
            </span>
            <span
              className={cn(
                "mt-1 block text-lg font-semibold",
                ringIf(isHl("checkout_title_color")),
              )}
              style={{ color: "var(--checkout-title)" }}
            >
              {display.name}
            </span>
          </div>

          <PreviewCheckoutPassCard
            title="Ticket 6 días"
            description="Acceso al evento completo (lun a sab)."
            price="$20.000"
            selected
          />
          <PreviewCheckoutPassCard
            title="Ticket 7 días"
            description="Acceso full al evento, incluye apertura."
            price="$25.000"
          />
          <PreviewCheckoutPassCard
            title="Entrada Niños"
            description="Menores de 12 años acompañados."
            price="$5.000"
          />
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 px-4">
        <div className="mx-auto max-w-2xl">
          <PreviewCheckoutBottomBar />
        </div>
      </div>
    </div>
  )
}
