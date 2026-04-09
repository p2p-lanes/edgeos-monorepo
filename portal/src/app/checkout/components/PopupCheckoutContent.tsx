"use client"

import { AnimatePresence, motion } from "framer-motion"
import { useRouter } from "next/navigation"
import { useEffect, useRef } from "react"
import type { PopupPublic } from "@/client"
import ScrollyCheckoutFlow from "@/components/checkout-flow/ScrollyCheckoutFlow"
import { SidebarProvider } from "@/components/Sidebar/SidebarComponents"
import { useApplication } from "@/providers/applicationProvider"
import { CheckoutProvider } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import PassesProvider from "@/providers/passesProvider"
import useCheckoutState from "../hooks/useCheckoutState"
import type { FormDataProps } from "../types"
import TransitionScreen from "./TransitionScreen"
import UserInfoForm from "./UserInfoForm"

export const PopupCheckoutContent = ({
  popup,
  background,
}: {
  popup: PopupPublic
  background: { className: string; style?: React.CSSProperties }
}) => {
  const {
    checkoutState,
    isSubmitting,
    errorMessage,
    handleSubmit,
    setCheckoutState,
  } = useCheckoutState({ popupId: popup.id })
  const { getRelevantApplication } = useApplication()
  const { getCity } = useCityProvider()
  const router = useRouter()
  const hasSkippedForm = useRef(false)

  useEffect(() => {
    if (checkoutState === "passes") {
      hasSkippedForm.current = true
    }
  }, [checkoutState])

  useEffect(() => {
    if (hasSkippedForm.current) return
    const existingApp = getRelevantApplication()
    if (!existingApp || checkoutState !== "form") return

    hasSkippedForm.current = true

    const hasPurchasedPasses = existingApp.attendees?.some(
      (a) => a.products && a.products.length > 0,
    )
    if (hasPurchasedPasses) {
      const city = getCity()
      router.replace(city?.slug ? `/portal/${city.slug}/passes` : "/portal")
      return
    }

    setCheckoutState("passes")
  }, [getRelevantApplication, checkoutState, setCheckoutState, getCity, router])

  const handleFormSubmit = async (formData: FormDataProps): Promise<void> => {
    await handleSubmit(formData)
  }

  // Passes state: full-page scrollable layout for ScrollyCheckoutFlow
  if (checkoutState === "passes") {
    return (
      <SidebarProvider
        defaultOpen={false}
        className="block min-h-0"
        style={
          {
            "--sidebar-width": "0px",
            "--sidebar-width-icon": "0px",
          } as React.CSSProperties
        }
      >
        <PassesProvider restoreFromCart>
          <CheckoutProvider initialStep="passes">
            <div className="h-screen overflow-y-auto">
              <ScrollyCheckoutFlow
                onBack={() => setCheckoutState("form")}
                onPaymentComplete={() => {}}
              />
            </div>
          </CheckoutProvider>
        </PassesProvider>
      </SidebarProvider>
    )
  }

  // Form/processing states: centered card layout with background
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
