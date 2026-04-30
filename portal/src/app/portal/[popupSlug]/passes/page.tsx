"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect } from "react"
import { resolvePopupCheckoutPolicy } from "@/checkout/popupCheckoutPolicy"
import type { CompanionParticipation } from "@/client"
import { CompanionPasses } from "@/components/CompanionPasses"
import { Loader } from "@/components/ui/Loader"
import { useHumanPopupAccess } from "@/hooks/useHumanPopupAccess"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import YourPasses from "./Tabs/YourPasses"

export default function HomePasses() {
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

  useEffect(() => {
    if (access.state === "denied") {
      router.replace(`/portal/${params.popupSlug}`)
    }
  }, [access.state, params.popupSlug, router])

  // Show loader while access is being resolved or while redirecting.
  if (access.state === "loading" || access.state === "denied") {
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

  if (!attendees.length || !products.length) return <Loader />

  return (
    <div className="w-full md:mt-0 mx-auto items-center max-w-3xl p-6 bg-transparent">
      <YourPasses
        access={access}
        onSwitchToBuy={() =>
          router.push(
            policy.saleType === "direct"
              ? `/portal/${params.popupSlug}`
              : `/portal/${params.popupSlug}/passes/buy`,
          )
        }
      />
    </div>
  )
}
