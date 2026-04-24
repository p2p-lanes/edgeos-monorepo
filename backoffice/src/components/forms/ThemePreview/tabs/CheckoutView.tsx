import { Ticket } from "lucide-react"
import { cn } from "@/lib/utils"
import { PreviewCheckoutBottomBar } from "../parts/PreviewCheckoutBottomBar"
import { PreviewCheckoutTopBar } from "../parts/PreviewCheckoutTopBar"
import { useDisplayEvent, usePreview } from "../parts/PreviewContext"
import { makeIsHl, ringIf } from "../parts/ring"

// Gradient fallback cuando el popup no tiene express_checkout_background —
// mantiene el cosmic look del checkout real aunque el usuario no haya subido
// imagen todavía.
const FALLBACK_BG =
  "radial-gradient(ellipse at 30% 20%, #4c3a8a 0%, #1b1540 50%, #080618 100%)"

// Replica del flujo de Pases del checkout real: background image fullscreen,
// navbar sticky con pills de steps, una sola card con el header del tenant y
// la sección "Experiencias" con un producto, y bottom bar flotante.
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

      <div className="flex-1 overflow-hidden px-4 pb-6 pt-6">
        <div
          className={cn(
            "mx-auto max-w-2xl overflow-hidden shadow-sm",
            ringIf(isHl("checkout_card_bg_color")),
          )}
          style={{
            backgroundColor: "var(--checkout-card-bg)",
            borderRadius: "calc(var(--radius) + 4px)",
          }}
        >
          <div className="flex items-center gap-3 px-4 py-3">
            <div
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
              style={{
                backgroundColor: "var(--checkout-badge-bg)",
                color: "var(--checkout-badge-title)",
              }}
            >
              {display.initial}
            </div>
            <div className="flex min-w-0 flex-col">
              <span
                className={cn(
                  "truncate text-sm font-semibold",
                  ringIf(isHl("checkout_title_color")),
                )}
                style={{ color: "var(--checkout-title)" }}
              >
                {display.name}
              </span>
              <span
                className={cn(
                  "text-[10px]",
                  ringIf(isHl("checkout_subtitle_color")),
                )}
                style={{ color: "var(--checkout-subtitle)" }}
              >
                V1.0
              </span>
            </div>
          </div>

          <div className="border-t border-black/5" />

          <div
            className={cn(
              "px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider",
              ringIf(isHl("checkout_subtitle_color")),
            )}
            style={{ color: "var(--checkout-subtitle)" }}
          >
            Experiences
          </div>

          <div className="flex items-start justify-between gap-4 px-4 pb-4">
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-center gap-2">
                <Ticket
                  className="size-4 shrink-0"
                  style={{ color: "var(--checkout-subtitle)" }}
                />
                <span
                  className={cn(
                    "text-sm font-semibold",
                    ringIf(isHl("checkout_title_color")),
                  )}
                  style={{ color: "var(--checkout-title)" }}
                >
                  4-Day Ticket
                </span>
              </div>
              <span
                className={cn(
                  "mt-1 text-xs",
                  ringIf(isHl("checkout_subtitle_color")),
                )}
                style={{ color: "var(--checkout-subtitle)" }}
              >
                Nov 20 → Nov 24
              </span>
              <span
                className={cn(
                  "mt-1 line-clamp-2 text-[11px]",
                  ringIf(isHl("checkout_subtitle_color")),
                )}
                style={{ color: "var(--checkout-subtitle)" }}
              >
                This ticket gives you access to all activities, workshops and
                shows during the four days of the festival. Join Amanita
                Festival: November 20–24,...
              </span>
              <span
                className={cn(
                  "mt-1 text-[11px] font-semibold",
                  ringIf(isHl("checkout_badge_bg_color")),
                )}
                style={{ color: "var(--checkout-badge-bg)" }}
              >
                See more
              </span>
            </div>
            <span
              className={cn(
                "shrink-0 text-sm font-bold",
                ringIf(isHl("checkout_title_color")),
              )}
              style={{ color: "var(--checkout-title)" }}
            >
              $215.000
            </span>
          </div>
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
