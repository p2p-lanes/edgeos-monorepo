"use client"

import { useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "framer-motion"
import { UserRound } from "lucide-react"
import { useRouter } from "next/navigation"
import { type CSSProperties, useEffect, useRef } from "react"
import { resolvePopupCheckoutPolicy } from "@/checkout/popupCheckoutPolicy"
import type { PopupPublic } from "@/client"
import ScrollyCheckoutFlow from "@/components/checkout-flow/ScrollyCheckoutFlow"
import { SidebarProvider } from "@/components/Sidebar/SidebarComponents"
import { Button } from "@/components/ui/button"
import { Loader } from "@/components/ui/Loader"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { useApplicationSchema } from "@/hooks/useApplicationSchema"
import useAuth from "@/hooks/useAuth"
import {
  dispatchAuthChange,
  useIsAuthenticated,
} from "@/hooks/useIsAuthenticated"
import useResolvedAttendees from "@/hooks/useResolvedAttendees"
import { queryKeys } from "@/lib/query-keys"
import { useApplication } from "@/providers/applicationProvider"
import { CheckoutProvider } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import PassesProvider from "@/providers/passesProvider"
import useCheckoutState from "../hooks/useCheckoutState"
import type {
  CheckoutApplicationValues,
  DefaultCheckoutFormData,
} from "../types"
import CheckoutLoginGate from "./CheckoutLoginGate"
import TransitionScreen from "./TransitionScreen"
import UserInfoForm from "./UserInfoForm"

export const PopupCheckoutContent = ({
  popup,
  background,
  groupId = null,
}: {
  popup: PopupPublic
  background: { className: string; style?: CSSProperties }
  groupId?: string | null
}) => {
  const policy = resolvePopupCheckoutPolicy(popup)
  const isAuthenticated = useIsAuthenticated()
  const { data: applicationSchema, isLoading: isLoadingApplicationSchema } =
    useApplicationSchema(
      policy.saleType === "application" && isAuthenticated
        ? popup.id
        : undefined,
    )
  const {
    checkoutState,
    isSubmitting,
    errorMessage,
    handleSubmit,
    setCheckoutState,
  } = useCheckoutState({
    popupId: popup.id,
    saleType: resolvePopupCheckoutPolicy(popup).saleType,
    groupId,
    schema: applicationSchema,
  })
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { getRelevantApplication } = useApplication()
  const { getCity, setCityPreselected } = useCityProvider()
  const router = useRouter()
  const hasSkippedForm = useRef(false)
  const attendees = useResolvedAttendees()
  const existingApplication = getRelevantApplication()

  useEffect(() => {
    setCityPreselected(popup.id)
  }, [popup.id, setCityPreselected])

  useEffect(() => {
    if (checkoutState === "passes") {
      hasSkippedForm.current = true
    }
  }, [checkoutState])

  useEffect(() => {
    if (hasSkippedForm.current) return
    if (policy.saleType !== "direct") return
    if (!isAuthenticated) return

    hasSkippedForm.current = true
    setCheckoutState("passes")
  }, [policy.saleType, isAuthenticated, setCheckoutState])

  useEffect(() => {
    if (hasSkippedForm.current) return
    if (policy.saleType !== "application") return
    if (!existingApplication || checkoutState !== "form") return

    hasSkippedForm.current = true

    const hasPurchasedPasses = existingApplication.attendees?.some(
      (a) => a.products && a.products.length > 0,
    )
    if (hasPurchasedPasses) {
      const city = getCity()
      router.replace(city?.slug ? `/portal/${city.slug}/passes` : "/portal")
      return
    }

    setCheckoutState("passes")
  }, [
    policy.saleType,
    existingApplication,
    checkoutState,
    setCheckoutState,
    getCity,
    router,
  ])

  const handleFormSubmit = async (
    formData: DefaultCheckoutFormData | CheckoutApplicationValues,
  ): Promise<void> => {
    await handleSubmit(formData)
  }

  const handleChangeEmailForDirectCheckout = () => {
    localStorage.removeItem("token")
    dispatchAuthChange()
    queryClient.removeQueries({ queryKey: queryKeys.profile.current })
    queryClient.removeQueries({ queryKey: queryKeys.applications.mine() })
    queryClient.removeQueries({ queryKey: queryKeys.cart.byPopup(popup.id) })
    queryClient.removeQueries({
      queryKey: queryKeys.purchases.byPopup(popup.id),
    })
    hasSkippedForm.current = false
    setCheckoutState("form")
  }

  const directSessionBanner =
    policy.saleType === "direct" && user?.email ? (
      <div className="flex justify-end">
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={`Signed in as ${user.email}`}
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-checkout-badge-bg text-checkout-badge-title shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <UserRound className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto max-w-[280px] p-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Signed in as
            </p>
            <p className="mt-0.5 truncate text-sm font-medium text-foreground">
              {user.email}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-3 w-full"
              onClick={handleChangeEmailForDirectCheckout}
            >
              Change email
            </Button>
          </PopoverContent>
        </Popover>
      </div>
    ) : null

  if (policy.saleType === "application") {
    if (!isAuthenticated) {
      return (
        <div
          className={`min-h-screen w-full py-8 flex items-center justify-center ${background.className}`}
          style={background.style}
        >
          <div className="container mx-auto">
            <CheckoutLoginGate />
          </div>
        </div>
      )
    }
  }

  if (
    policy.saleType === "direct" &&
    checkoutState === "form" &&
    isAuthenticated
  ) {
    return <Loader />
  }

  if (
    policy.saleType === "application" &&
    isAuthenticated &&
    checkoutState === "form" &&
    !existingApplication &&
    (isLoadingApplicationSchema || !applicationSchema)
  ) {
    return <Loader />
  }

  if (checkoutState === "passes") {
    return (
      <SidebarProvider
        defaultOpen={false}
        className="block min-h-0"
        style={
          {
            "--sidebar-width": "0px",
            "--sidebar-width-icon": "0px",
          } as CSSProperties
        }
      >
        <PassesProvider attendees={attendees} restoreFromCart>
          <CheckoutProvider initialStep="passes">
            <div
              className={`h-dvh overflow-y-auto ${background.className}`}
              style={background.style}
            >
              <ScrollyCheckoutFlow
                onBack={() => setCheckoutState("form")}
                onPaymentComplete={() => {}}
                navExtraContent={directSessionBanner}
              />
            </div>
          </CheckoutProvider>
        </PassesProvider>
      </SidebarProvider>
    )
  }

  return (
    <div
      className={`min-h-screen w-full py-8 flex items-center justify-center ${background.className}`}
      style={background.style}
    >
      <div className="container mx-auto">
        <AnimatePresence mode="wait">
          {checkoutState === "form" && (
            <motion.div
              key="form"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.5 }}
            >
              <UserInfoForm
                popupId={popup.id}
                popupName={popup.name}
                schema={applicationSchema}
                onSubmit={handleFormSubmit}
                isSubmitting={isSubmitting}
              />
            </motion.div>
          )}

          {checkoutState === "processing" && (
            <TransitionScreen
              message="Processing your registration"
              isPending={true}
              isSuccess={false}
            />
          )}
        </AnimatePresence>

        {errorMessage && (
          <div className="mt-4 p-4 bg-red-100 border border-red-300 text-red-800 rounded-md max-w-lg mx-auto">
            {errorMessage}
          </div>
        )}
      </div>
    </div>
  )
}
