"use client"

import { AlertCircle, ArrowRight, RefreshCw, Ticket } from "lucide-react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import type { CompanionParticipation } from "@/client"
import { CompanionPasses } from "@/components/CompanionPasses"
import { Button, ButtonAnimated } from "@/components/ui/button"
import { Loader } from "@/components/ui/Loader"
import useHumanAttendeesQuery from "@/hooks/useHumanAttendeesQuery"
import useHumanPaymentsQuery from "@/hooks/useHumanPaymentsQuery"
import { useHumanPopupAccess } from "@/hooks/useHumanPopupAccess"
import { usePortalDirectSalesFlows } from "@/hooks/usePortalDirectSalesFlows"
import { usePortalSalesFlows } from "@/hooks/usePortalSalesFlows"
import { usePortalUpsaleFlows } from "@/hooks/usePortalUpsaleFlows"
import {
  getEligiblePortalFlows,
  groupPassesBySalesFlow,
  OTHER_PASSES_VIEW,
  type PassesFlowChoice,
  resolvePassesFlowSelection,
  resolvePassPurchaseFlowSlug,
} from "@/lib/portal-sales-flows"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import type { AttendeePassState } from "@/types/Attendee"
import YourPasses from "./Tabs/YourPasses"

function countPasses(attendees: AttendeePassState[]) {
  return attendees.reduce((count, attendee) => {
    const ticketCount = attendee.ticket_entries?.length ?? 0
    if (ticketCount > 0) return count + ticketCount
    return (
      count + attendee.products.filter((product) => product.purchased).length
    )
  }, 0)
}

export default function HomePasses() {
  const { t } = useTranslation()
  const params = useParams<{ popupSlug: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const searchParamsString = searchParams.toString()
  const explicitFlowIdentifier = searchParams.get("flow")
  const selectOtherPasses = searchParams.get("view") === OTHER_PASSES_VIEW
  const { getApplicationsForPopup, participation } = useApplication()
  const { getCity } = useCityProvider()
  const { attendeePasses: attendees, products } = usePassesProvider()
  const city = getCity()
  const popupId = city?.id ? String(city.id) : undefined
  const access = useHumanPopupAccess(popupId ?? null)
  const nobodyApplies = city?.takes_applications === false
  const attendeesQuery = useHumanAttendeesQuery(popupId ?? null)
  const paymentsQuery = useHumanPaymentsQuery(popupId, { limit: 100 })
  const applicationFlowsQuery = usePortalSalesFlows(popupId)
  const directFlowsQuery = usePortalDirectSalesFlows(popupId)
  const upsaleFlowsQuery = usePortalUpsaleFlows(popupId)
  const applicationFlows = applicationFlowsQuery.data ?? []
  const directFlows = directFlowsQuery.data ?? []
  const upsaleFlows = upsaleFlowsQuery.data ?? []
  const applications = getApplicationsForPopup()
  const approvedApplicationFlowIds = new Set<string>(
    applications.flatMap((application) =>
      application.status === "accepted" && application.sales_flow_id
        ? [application.sales_flow_id]
        : [],
    ),
  )
  const eligibleFlows = getEligiblePortalFlows({
    application: applicationFlows,
    direct: directFlows,
    upsale: upsaleFlows,
    approvedApplicationFlowIds,
  })
  const eligibleFlowIds = new Set(eligibleFlows.map((flow) => flow.id))
  const eligibleApplicationFlows = applicationFlows.filter((flow) =>
    eligibleFlowIds.has(flow.id),
  )
  const eligibleDirectFlows = directFlows.filter((flow) =>
    eligibleFlowIds.has(flow.id),
  )
  const purchaseApplications = applications.flatMap((application) =>
    application.sales_flow_id
      ? [{ id: application.id, sales_flow_id: application.sales_flow_id }]
      : [],
  )
  const groupedPasses = groupPassesBySalesFlow({
    attendees,
    applications: purchaseApplications,
    eligibleFlows,
    payments: paymentsQuery.data ?? [],
  })
  const flowSelection = resolvePassesFlowSelection(
    groupedPasses,
    explicitFlowIdentifier,
    selectOtherPasses,
  )
  const canonicalFlowSlug =
    flowSelection.state === "selected" ? flowSelection.canonicalFlowSlug : null

  useEffect(() => {
    if (!nobodyApplies && access.state === "denied") {
      router.replace(`/portal/${params.popupSlug}`)
    }
  }, [access.state, nobodyApplies, params.popupSlug, router])

  useEffect(() => {
    if (!canonicalFlowSlug) return

    const query = new URLSearchParams(searchParamsString)
    query.set("flow", canonicalFlowSlug)
    router.replace(`/portal/${params.popupSlug}/passes?${query.toString()}`)
  }, [canonicalFlowSlug, params.popupSlug, router, searchParamsString])

  if (!city || access.state === "loading") return <Loader />
  if (!nobodyApplies && access.state === "denied") return <Loader />

  if (attendeesQuery.isError && attendeesQuery.data === undefined) {
    return (
      <div className="w-full md:mt-0 mx-auto items-center max-w-3xl p-6 bg-transparent">
        <div className="flex flex-col items-center justify-center rounded-2xl border bg-card p-10 text-center shadow-sm">
          <div className="size-12 rounded-full bg-destructive/15 flex items-center justify-center mb-4">
            <AlertCircle className="size-6 text-destructive" />
          </div>
          <h2 className="text-xl font-semibold">
            {t("passes.error_title", {
              defaultValue: "Couldn't load your tickets",
            })}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-sm">
            {t("passes.error_description", {
              defaultValue:
                "Something went wrong while fetching your tickets. Please try again.",
            })}
          </p>
          <Button
            className="mt-6"
            onClick={() => attendeesQuery.refetch()}
            disabled={attendeesQuery.isFetching}
          >
            <RefreshCw className="size-4" />
            {t("passes.error_retry", { defaultValue: "Try again" })}
          </Button>
        </div>
      </div>
    )
  }

  if (participation?.type === "companion") {
    return (
      <div className="w-full md:mt-0 mx-auto items-center max-w-3xl p-6 bg-transparent">
        <CompanionPasses
          participation={participation as CompanionParticipation}
        />
      </div>
    )
  }

  const getPurchasePath = (attendee?: AttendeePassState) => {
    const flowSlug = resolvePassPurchaseFlowSlug({
      explicitFlowIdentifier,
      attendeeApplicationId: attendee?.application_id,
      applications: purchaseApplications,
      eligibleFlows,
      eligibleApplicationFlows,
      eligibleDirectFlows,
    })
    return flowSlug
      ? `/portal/${params.popupSlug}/shop/${flowSlug}`
      : `/portal/${params.popupSlug}`
  }
  const openPurchase = (attendee?: AttendeePassState) => {
    router.push(getPurchasePath(attendee))
  }
  const openFlowPurchase = (flowSlug: string) => {
    router.push(`/portal/${params.popupSlug}/shop/${flowSlug}`)
  }
  const openPassesChoice = (choice: PassesFlowChoice) => {
    const query = new URLSearchParams(searchParamsString)
    if (choice.kind === "flow") {
      query.delete("view")
      query.set("flow", choice.flow.slug)
    } else {
      query.delete("flow")
      query.set("view", OTHER_PASSES_VIEW)
    }
    router.push(`/portal/${params.popupSlug}/passes?${query.toString()}`)
  }
  const openFlowSelector = () => {
    const query = new URLSearchParams(searchParamsString)
    query.delete("flow")
    query.delete("view")
    const suffix = query.size > 0 ? `?${query.toString()}` : ""
    router.push(`/portal/${params.popupSlug}/passes${suffix}`)
  }

  const emptyState = (
    <div className="w-full md:mt-0 mx-auto items-center max-w-3xl p-6 bg-transparent">
      <div className="flex flex-col items-center justify-center rounded-2xl border bg-card p-10 text-center shadow-sm">
        <Ticket className="size-10 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold">
          {t("passes.empty_title", { defaultValue: "No tickets yet" })}
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("passes.empty_description", {
            defaultValue:
              "You haven't purchased any tickets for this event yet.",
          })}
        </p>
        {products.length > 0 && (
          <div className="mt-6">
            <ButtonAnimated onClick={() => openPurchase()} className="px-9">
              {t("cta.buy_tickets")}
            </ButtonAnimated>
          </div>
        )}
      </div>
    </div>
  )

  if (nobodyApplies) {
    if (attendeesQuery.isLoading) return <Loader />
    if (access.state === "denied" || !attendees.length) return emptyState
  } else {
    if (access.state !== "allowed") return <Loader />
    if (attendeesQuery.isLoading) return <Loader />
    const ownsNoAttendees = (attendeesQuery.data?.length ?? 0) === 0
    if (ownsNoAttendees) return emptyState
    if (!attendees.length) return <Loader />
  }

  if (
    applicationFlowsQuery.isLoading ||
    directFlowsQuery.isLoading ||
    upsaleFlowsQuery.isLoading
  ) {
    return <Loader />
  }

  const needsPaymentAttribution = attendees.some(
    (attendee) =>
      !attendee.application_id ||
      attendee.ticket_entries?.some((ticket) => ticket.payment_id),
  )
  if (needsPaymentAttribution && paymentsQuery.isLoading) return <Loader />

  if (flowSelection.state === "choose") {
    return (
      <div className="w-full md:mt-0 mx-auto max-w-3xl p-6 bg-transparent">
        <div className="space-y-2">
          <div className="flex items-center gap-3">
            <Ticket className="size-6 text-pass-text" />
            <h1 className="text-3xl font-bold tracking-tight text-pass-title">
              {t("passes.your_passes")}
            </h1>
          </div>
          <p className="text-pass-text">
            {t("passes.choose_flow_description")}
          </p>
        </div>

        <div className="mt-8 space-y-3">
          <h2 className="text-lg font-semibold text-pass-title">
            {t("passes.choose_flow")}
          </h2>
          <ul className="space-y-3">
            {flowSelection.choices.map((choice) => {
              const name =
                choice.kind === "flow"
                  ? choice.flow.name
                  : t("passes.other_passes")
              return (
                <li key={choice.identifier}>
                  <button
                    type="button"
                    onClick={() => openPassesChoice(choice)}
                    className="flex w-full items-center justify-between gap-4 rounded-2xl border border-border bg-card p-5 text-left shadow-sm transition-colors hover:border-foreground/30 hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span>
                      <span className="block font-semibold text-pass-title">
                        {name}
                      </span>
                      <span className="mt-1 block text-sm text-muted-foreground">
                        {t("passes.item_count", {
                          count: countPasses(choice.attendees),
                        })}
                      </span>
                    </span>
                    <ArrowRight className="size-5 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    )
  }

  if (flowSelection.state === "empty") return emptyState

  const selectedChoice = flowSelection.choice
  const scopedPurchase =
    selectedChoice.kind === "flow"
      ? () => openFlowPurchase(selectedChoice.flow.slug)
      : undefined

  return (
    <div className="w-full md:mt-0 mx-auto items-center max-w-3xl p-6 bg-transparent">
      {flowSelection.choices.length > 1 && (
        <Button variant="ghost" className="mb-4" onClick={openFlowSelector}>
          {t("passes.change_flow")}
        </Button>
      )}
      <YourPasses
        key={selectedChoice.kind === "flow" ? selectedChoice.flow.id : "other"}
        access={access}
        attendees={selectedChoice.attendees}
        onSwitchToBuy={scopedPurchase}
        readOnly={city.status === "ended"}
        salesFlowId={
          selectedChoice.kind === "flow" ? selectedChoice.flow.id : null
        }
      />
    </div>
  )
}
