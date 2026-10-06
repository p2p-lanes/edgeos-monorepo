import { usePathname, useRouter } from "next/navigation"
import { useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import useResources from "../hooks/useResources"

const Permissions = ({ children }: { children: React.ReactNode }) => {
  const route = usePathname()
  const router = useRouter()
  const { resources, permissionsLoading } = useResources()
  const allowed = resources.some(
    (resource) => resource.path === route && resource.status === "active",
  )

  useEffect(() => {
    if (permissionsLoading || allowed) return
    router.push("/portal")
  }, [permissionsLoading, allowed, router])

  if (permissionsLoading) return <Loader />

  if (allowed) {
    return children
  }
  return <div>You are not authorized to access this page</div>
}
export default Permissions
