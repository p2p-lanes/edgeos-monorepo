"use client"

import { AlertCircle, RefreshCw, ShoppingBag, Ticket } from "lucide-react"
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
  resolvePassPurchaseFlowSlug,
} from "@/lib/portal-sales-flows"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import type { AttendeePassState } from "@/types/Attendee"
import { OtherPurchasedProducts } from "./components/OtherPurchasedProducts"
import { projectOtherPurchasedProducts } from "./otherProductsProjection"
import YourPasses from "./Tabs/YourPasses"

export default function HomePasses() {
  const { t } = useTranslation()
  const params = useParams<{ popupSlug: string }>()
  const router = useRouter()
  const searchParams = useSearchParams()
  const explicitFlowIdentifier = searchParams.get("flow")
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

  useEffect(() => {
    if (!nobodyApplies && access.state === "denied") {
      router.replace(`/portal/${params.popupSlug}`)
    }
  }, [access.state, nobodyApplies, params.popupSlug, router])

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
  } else {
    if (access.state !== "allowed") return <Loader />
    if (attendeesQuery.isLoading) return <Loader />
    if ((attendeesQuery.data?.length ?? 0) > 0 && !attendees.length) {
      return <Loader />
    }
  }

  if (
    applicationFlowsQuery.isLoading ||
    directFlowsQuery.isLoading ||
    upsaleFlowsQuery.isLoading
  ) {
    return <Loader />
  }

  if (paymentsQuery.isLoading) return <Loader />

  const passSections = [
    ...groupedPasses.sections.map(({ flow, attendees: flowAttendees }) => ({
      id: flow.id,
      title: flow.name,
      attendees: flowAttendees,
      salesFlowId: flow.id,
      onSwitchToBuy: () =>
        router.push(`/portal/${params.popupSlug}/shop/${flow.slug}`),
    })),
    ...(groupedPasses.unassignedAttendees.length > 0
      ? [
          {
            id: "other",
            title: t("passes.other_passes"),
            attendees: groupedPasses.unassignedAttendees,
            salesFlowId: null,
            onSwitchToBuy: undefined,
          },
        ]
      : []),
  ]
  const visiblePasses = [
    ...groupedPasses.sections.flatMap((section) => section.attendees),
    ...groupedPasses.unassignedAttendees,
  ].flatMap((attendee) =>
    (attendee.ticket_entries ?? [])
      .filter((ticket) => ticket.product_category !== "patreon")
      .map((ticket) => ({
        id: ticket.id,
        paymentId: ticket.payment_id,
        productId: ticket.product_id,
      })),
  )
  const otherProducts = projectOtherPurchasedProducts(
    paymentsQuery.data ?? [],
    new Set(applicationFlows.map((flow) => flow.id)),
    visiblePasses,
  )

  if (passSections.length === 0 && otherProducts.length === 0) return emptyState

  return (
    <div className="w-full md:mt-0 mx-auto items-center max-w-3xl p-6 bg-transparent">
      <div className="mb-8 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <ShoppingBag className="size-6 text-pass-text" />
          <h1 className="text-3xl font-bold tracking-tight text-pass-title">
            {t("passes.your_purchases")}
          </h1>
        </div>
        <p className="text-pass-text">
          {t("passes.your_purchases_description")}
        </p>
      </div>

      <div>
        {passSections.map((section, index) => (
          <div
            key={section.id}
            className={index === 0 ? "" : "mt-10 border-t border-border pt-10"}
          >
            <YourPasses
              attendees={section.attendees}
              inlineCta={passSections.length > 1}
              onSwitchToBuy={section.onSwitchToBuy}
              readOnly={city.status === "ended"}
              salesFlowId={section.salesFlowId}
              sectionTitle={passSections.length > 1 ? section.title : undefined}
            />
          </div>
        ))}

        {otherProducts.length > 0 && (
          <div
            className={
              passSections.length > 0
                ? "mt-10 border-t border-border pt-10"
                : ""
            }
          >
            <OtherPurchasedProducts
              products={otherProducts}
              paymentsHref={`/portal/${params.popupSlug}/orders`}
            />
          </div>
        )}
      </div>
    </div>
  )
}
