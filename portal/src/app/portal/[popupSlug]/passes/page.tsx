"use client"

import { useParams, useRouter } from "next/navigation"
import { Loader } from "@/components/ui/Loader"
import { usePassesProvider } from "@/providers/passesProvider"
import usePermission from "./hooks/usePermission"
import YourPasses from "./Tabs/YourPasses"

export default function HomePasses() {
  usePermission()

  const params = useParams()
  const router = useRouter()
  const { attendeePasses: attendees, products } = usePassesProvider()

  if (!attendees.length || !products.length) return <Loader />

  return (
    <div className="w-full md:mt-0 mx-auto items-center max-w-3xl p-6 bg-[#F5F5F7]">
      <YourPasses
        onSwitchToBuy={() =>
          router.push(`/portal/${params.popupSlug}/passes/buy`)
        }
      />
    </div>
  )
}
