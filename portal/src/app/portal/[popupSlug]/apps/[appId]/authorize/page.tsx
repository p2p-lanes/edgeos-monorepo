import { Suspense } from "react"
import { ThirdPartyAppLaunch } from "@/components/Portal/ThirdPartyAppLaunch"
import { Loader } from "@/components/ui/Loader"

export default function AppAuthorizePage() {
  return (
    <Suspense fallback={<Loader />}>
      <ThirdPartyAppLaunch authorize />
    </Suspense>
  )
}
