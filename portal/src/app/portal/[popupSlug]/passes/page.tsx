"use client"

import { Ticket } from "lucide-react"
import { useParams, useRouter } from "next/navigation"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { resolvePopupCheckoutPolicy } from "@/checkout/popupCheckoutPolicy"
import type { CompanionParticipation } from "@/client"
import { CompanionPasses } from "@/components/CompanionPasses"
import { ButtonAnimated } from "@/components/ui/button"
import { Loader } from "@/components/ui/Loader"
import { useHumanPopupAccess } from "@/hooks/useHumanPopupAccess"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import YourPasses from "./Tabs/YourPasses"

export default function HomePasses() {
  const { t } = useTranslation()
  const params = useParams()
  const router = useRouter()
  const { participation } = useApplication()
  const { getCity } = useCityProvider()
  const { attendeePasses: attendees, products } = usePassesProvider()
  const city = getCity()
  const policy = resolvePopupCheckoutPolicy(city)

  // Gate access via the unified 7-step access ladder. The hook does NOT
  // redirect — routing decisions are handled here so they remain testable
  // in isolation from the query logic.
  const access = useHumanPopupAccess(city?.id ? String(city.id) : null)
  const isDirectSale = policy.saleType === "direct"

  useEffect(() => {
    // For direct-sale popups we keep /passes accessible even when the human
    // hasn't bought yet — the page renders an empty state with a CTA back to
    // /checkout. Application popups still gate via the access ladder.
    if (!isDirectSale && access.state === "denied") {
      router.replace(`/portal/${params.popupSlug}`)
    }
  }, [access.state, isDirectSale, params.popupSlug, router])

  // Show loader while access is being resolved (and, for non-direct popups,
  // while redirecting after denial).
  if (access.state === "loading") {
    return <Loader />
  }
  if (!isDirectSale && access.state === "denied") {
    return <Loader />
  }

  // Companions don't have an Application, so PassesProvider data will be empty.
  // Show companion-specific passes view instead. The participation flag is
  // orthogonal to the access gate — both must agree but answer different questions
  // ("can render?" vs "render which view?").
  if (participation?.type === "companion") {
    return (
      <div className="w-full md:mt-0 mx-auto items-center max-w-3xl p-6 bg-transparent">
        <CompanionPasses
          participation={participation as CompanionParticipation}
        />
      </div>
    )
  }

  // Direct-sale users without purchases land here via the sidebar — show an
  // empty state instead of an infinite loader, with a CTA back to /checkout.
  if (isDirectSale && (access.state === "denied" || !attendees.length)) {
    return (
      <div className="w-full md:mt-0 mx-auto items-center max-w-3xl p-6 bg-transparent">
        <div className="flex flex-col items-center justify-center rounded-2xl border bg-card p-10 text-center shadow-sm">
          <Ticket className="size-10 text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold">
            {t("passes.empty_title", { defaultValue: "No tickets yet" })}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("passes.empty_description", {
              defaultValue:
                "You haven't purchased any tickets for this event yet.",
            })}
          </p>
          <div className="mt-6">
            <ButtonAnimated
              onClick={() => router.push(`/checkout/${params.popupSlug}`)}
              className="px-9"
            >
              {t("cta.buy_tickets")}
            </ButtonAnimated>
          </div>
        </div>
      </div>
    )
  }

  if (!attendees.length || !products.length) return <Loader />
  if (access.state !== "allowed") return <Loader />

  return (
    <div className="w-full md:mt-0 mx-auto items-center max-w-3xl p-6 bg-transparent">
      <YourPasses
        access={access}
        onSwitchToBuy={() =>
          router.push(
            isDirectSale
              ? `/checkout/${params.popupSlug}`
              : `/portal/${params.popupSlug}/passes/buy`,
          )
        }
      />
    </div>
  )
}
