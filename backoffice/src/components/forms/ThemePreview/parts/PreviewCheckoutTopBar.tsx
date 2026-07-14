import {
  BedDouble,
  Check,
  Image as ImageIcon,
  type LucideIcon,
  Sparkles,
  Ticket,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { usePreview } from "./PreviewContext"
import { makeIsHl, ringIf } from "./ring"

interface Step {
  id: string
  label: string
  icon: LucideIcon
  active?: boolean
}

const STEPS: Step[] = [
  { id: "pases", label: "Passes", icon: Ticket, active: true },
  { id: "alojamiento", label: "Housing", icon: BedDouble },
  { id: "experiencias", label: "Experiences", icon: Sparkles },
  { id: "galeria", label: "Gallery", icon: ImageIcon },
  { id: "continuar", label: "Continue", icon: Check },
]

export function PreviewCheckoutTopBar() {
  const { highlightedKeys, navVariant } = usePreview()
  const isHl = makeIsHl(highlightedKeys)
  const isPills = navVariant === "pills"

  return (
    <div
      className={cn(
        "sticky top-0 z-20 backdrop-blur-md",
        ringIf(isHl("checkout_navbar_bg_color", "checkout_navbar_bg_to")),
      )}
      style={{
        backgroundColor: "var(--checkout-navbar-bg)",
        backgroundImage: "var(--checkout-navbar-image, none)",
      }}
    >
      <div className="mx-auto flex max-w-2xl items-center gap-1.5 overflow-x-auto px-4 py-2">
        {STEPS.map((step) => {
          const Icon = step.icon
          const activeStyle = {
            backgroundColor: "var(--checkout-badge-bg)",
            color: "var(--checkout-badge-title)",
            borderColor: "var(--checkout-badge-border)",
          }
          const inactiveStyle = isPills
            ? {
                backgroundColor: "transparent",
                color: "var(--checkout-badge-title-disabled)",
                borderColor: "var(--checkout-navbar-border)",
              }
            : {
                backgroundColor: "var(--checkout-badge-bg-disabled)",
                color: "var(--checkout-badge-title-disabled)",
                borderColor: "transparent",
              }
          return (
            <button
              key={step.id}
              type="button"
              tabIndex={-1}
              className={cn(
                "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1.5 text-[11px] font-semibold",
                ringIf(
                  isHl(
                    "checkout_badge_bg_color",
                    "checkout_badge_title_color",
                    "checkout_badge_border",
                    "checkout_navbar_border",
                  ),
                ),
              )}
              style={step.active ? activeStyle : inactiveStyle}
            >
              <Icon className="size-3.5 shrink-0" />
              {step.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
