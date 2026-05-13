"use client"

import dynamic from "next/dynamic"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect } from "react"
import Quote from "@/app/auth/Quote"
import { Loader } from "@/components/ui/Loader"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { getSafeReturnTo } from "@/lib/safe-return-to"

const AuthForm = dynamic(() => import("@/app/auth/AuthForm"), {
  ssr: false,
})

function AuthContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const loggedIn = useIsAuthenticated()

  useEffect(() => {
    if (loggedIn) {
      router.replace(getSafeReturnTo(searchParams.get("returnTo")) ?? "/portal")
    }
  }, [loggedIn, router, searchParams])

  if (loggedIn) {
    return (
      <div className="w-full h-full">
        <Loader />
      </div>
    )
  }

  return (
    <div className="flex min-h-screen">
      <Quote />
      <AuthForm />
    </div>
  )
}

export default function AuthPage() {
  return (
    <Suspense
      fallback={
        <div className="w-full h-full">
          <Loader />
        </div>
      }
    >
      <AuthContent />
    </Suspense>
  )
}
