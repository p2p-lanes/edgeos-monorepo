"use client"

import { useParams, useRouter } from "next/navigation"
import type { CompanionParticipation } from "@/client"
import { CompanionPasses } from "@/components/CompanionPasses"
import { Loader } from "@/components/ui/Loader"
import { useApplication } from "@/providers/applicationProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import usePermission from "./hooks/usePermission"
import YourPasses from "./Tabs/YourPasses"

export default function HomePasses() {
  usePermission()

  const params = useParams()
  const router = useRouter()
  const { participation } = useApplication()
  const { attendeePasses: attendees, products } = usePassesProvider()

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
          router.push(`/portal/${params.popupSlug}/passes/buy`)
        }
      />
    </div>
  )
}
