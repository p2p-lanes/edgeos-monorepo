"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AnimatePresence, motion } from "framer-motion"
import { UserRound } from "lucide-react"
import { useRouter } from "next/navigation"
import { type CSSProperties, useEffect, useRef, useState } from "react"
import { resolvePopupCheckoutPolicy } from "@/checkout/popupCheckoutPolicy"
import { ApiError, ApplicationsService, type PopupPublic } from "@/client"
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
import {
  type CompanionSwitchMode,
  CompanionSwitchPrompt,
} from "./CompanionSwitchPrompt"
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
    joinGroupAsApplicant,
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

  // Companion-on-someone-else's-application detection. Only active when the
  // user arrived via a group invite link (groupId set) and is authenticated;
  // the participation endpoint is portal-only and would 401 otherwise.
  const isGroupFlow = !!groupId && policy.saleType === "application"
  const { data: participation } = useQuery({
    queryKey: queryKeys.participation.byPopup(popup.id),
    queryFn: () =>
      ApplicationsService.getMyParticipation({ popupId: popup.id }),
    enabled: isGroupFlow && isAuthenticated,
  })
  // Dialog open-state is DERIVED from participation, not stored. Storing the
  // mode in state caused a re-open race: when onSuccess set state to null,
  // useEffect re-fired before participation refetched — so the dialog
  // immediately re-opened from stale companion data. Derived avoids the race.
  //
  // We pick prompt vs blocked-paid up-front based on whether the companion's
  // attendee row already has paid tickets — no need to make the user click
  // Continue Here and discover the 409. paidBlockOverride is a defensive
  // fallback for the (rare) case where participation cache is stale and a
  // ticket got purchased in the meantime, so the mutation 409s.
  const [paidBlockOverride, setPaidBlockOverride] = useState(false)
  const isCompanion = participation?.type === "companion"
  const companionHasPaidTickets =
    participation?.type === "companion" &&
    (participation.attendee?.tickets?.length ?? 0) > 0
  const companionDialogMode: CompanionSwitchMode | null =
    paidBlockOverride || (isCompanion && companionHasPaidTickets)
      ? "blocked-paid"
      : isCompanion
        ? "prompt"
        : null
  const ownerEmail =
    participation?.type === "companion"
      ? (participation.owner_email ?? null)
      : null
  const companionCategory =
    participation?.type === "companion"
      ? (participation.attendee?.category ?? null)
      : null

  const detachMutation = useMutation({
    mutationFn: () =>
      ApplicationsService.detachCompanion({
        requestBody: { popup_id: popup.id },
      }),
    onSuccess: () => {
      // Don't mutate any dialog state — the refetched participation will
      // become "none" or "applicant" and the derived mode closes the dialog.
      queryClient.invalidateQueries({
        queryKey: queryKeys.participation.byPopup(popup.id),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.attendees.byHumanPopup(popup.id),
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.applications.mine(),
      })
    },
    onError: (err) => {
      if (err instanceof ApiError && err.status === 409) {
        const body = err.body as { detail?: { code?: string } } | undefined
        if (body?.detail?.code === "tickets_already_purchased") {
          setPaidBlockOverride(true)
          return
        }
      }
      // unknown error — keep the prompt open so the user can retry or cancel
    },
  })

  const handleCompanionCancel = () => {
    // Per spec: cancel == log out + return portal to email-entry state.
    setPaidBlockOverride(false)
    localStorage.removeItem("token")
    dispatchAuthChange()
    queryClient.removeQueries({ queryKey: queryKeys.profile.current })
    queryClient.removeQueries({ queryKey: queryKeys.applications.mine() })
    queryClient.removeQueries({
      queryKey: queryKeys.participation.byPopup(popup.id),
    })
    queryClient.removeQueries({
      queryKey: queryKeys.attendees.byHumanPopup(popup.id),
    })
  }

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
    // Branch guarded by sale_type=application. Direct-checkout (landing_mode=checkout)
    // only resolves direct-sale popups (backend resolve_active_direct_popup_slug),
    // so this redirect to /portal is structurally unreachable in checkout mode.
    if (policy.saleType !== "application") return
    if (!existingApplication || checkoutState !== "form") return
    // In a group flow, wait for participation to resolve and never auto-skip a
    // companion — the CompanionSwitchPrompt drives that case.
    if (isGroupFlow) {
      if (participation === undefined) return
      if (isCompanion) return
    }

    hasSkippedForm.current = true

    const hasPurchasedPasses = existingApplication.attendees?.some(
      (a) => a.products && a.products.length > 0,
    )
    if (hasPurchasedPasses) {
      const city = getCity()
      router.replace(city?.slug ? `/portal/${city.slug}/passes` : "/portal")
      return
    }

    // Existing applicant clicking a group invite link whose application isn't
    // accepted yet: persist the group membership so the backend auto-accepts it
    // before checkout, otherwise the payment step 403s ("Application must be
    // accepted before purchasing products"). Only attempt it for statuses the
    // backend allows updating (draft/pending_fee/in review); rejected/withdrawn
    // fall through unchanged and stay gated at payment.
    const joinableStatuses = ["draft", "pending_fee", "in review"]
    if (groupId && joinableStatuses.includes(existingApplication.status)) {
      joinGroupAsApplicant()
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
    groupId,
    isGroupFlow,
    participation,
    isCompanion,
    joinGroupAsApplicant,
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

  // Companion-switch dialog takes over the page when active — render it
  // without the underlying form so the user isn't distracted by it bleeding
  // through the overlay.
  if (companionDialogMode !== null && isAuthenticated && isGroupFlow) {
    return (
      <div
        className={`min-h-screen w-full ${background.className}`}
        style={background.style}
      >
        <CompanionSwitchPrompt
          open
          mode={companionDialogMode}
          ownerEmail={ownerEmail}
          companionCategory={companionCategory}
          isSwitching={detachMutation.isPending}
          onSwitch={() => detachMutation.mutate()}
          onCancel={handleCompanionCancel}
        />
      </div>
    )
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
          <CheckoutProvider initialStep="passes" openCartPopupSlug={popup.slug}>
            <div
              className={`h-dvh overflow-y-auto no-scrollbar ${background.className}`}
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
