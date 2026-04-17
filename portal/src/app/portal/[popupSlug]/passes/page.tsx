"use client"

import { useParams, useRouter } from "next/navigation"
import { resolvePopupCheckoutPolicy } from "@/checkout/popupCheckoutPolicy"
import type { CompanionParticipation } from "@/client"
import { CompanionPasses } from "@/components/CompanionPasses"
import { Loader } from "@/components/ui/Loader"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import usePermission from "./hooks/usePermission"
import YourPasses from "./Tabs/YourPasses"

export default function HomePasses() {
  usePermission()

  const params = useParams()
  const router = useRouter()
  const { participation } = useApplication()
  const { getCity } = useCityProvider()
  const { attendeePasses: attendees, products } = usePassesProvider()
  const city = getCity()
  const policy = resolvePopupCheckoutPolicy(city)

  // Companions don't have an Application, so PassesProvider data will be empty.
  // Show companion-specific passes view instead.
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
