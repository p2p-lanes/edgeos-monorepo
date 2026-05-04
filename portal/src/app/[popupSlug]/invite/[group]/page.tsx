"use client"

import { useParams, useRouter } from "next/navigation"
import { useEffect } from "react"
import { Loader } from "@/components/ui/Loader"
import { getPublicGroupPath } from "@/lib/group-route"

export default function InviteRedirectPage() {
  const { group } = useParams()
  const router = useRouter()

  useEffect(() => {
    if (group) {
      router.replace(getPublicGroupPath(String(group)))
    } else {
      router.replace("/")
    }
  }, [group, router])

  return <Loader />
}
