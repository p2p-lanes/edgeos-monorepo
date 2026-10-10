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
import useMyTicketsQuery from "@/hooks/useMyTicketsQuery"
import { usePortalDirectSalesFlows } from "@/hooks/usePortalDirectSalesFlows"
import { usePortalPrimarySalesFlow } from "@/hooks/usePortalPrimarySalesFlow"
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
import { PersonalTicketPasses } from "./components/PersonalTicketPasses"
import { projectOtherPurchasedProducts } from "./otherProductsProjection"
import { projectPersonalTickets } from "./personalTicketsProjection"
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
  const hasTicketAccess =
    access.state === "allowed" &&
    (access.source === "attendee" || access.source === "payment")
  const nobodyApplies = city?.takes_applications === false
  const attendeesQuery = useHumanAttendeesQuery(popupId ?? null)
  const personalTicketsQuery = useMyTicketsQuery()
  const paymentsQuery = useHumanPaymentsQuery(popupId, { limit: 100 })
  const applicationFlowsQuery = usePortalSalesFlows(popupId)
  const directFlowsQuery = usePortalDirectSalesFlows(popupId)
  const upsaleFlowsQuery = usePortalUpsaleFlows(popupId)
  const primaryFlowQuery = usePortalPrimarySalesFlow(params.popupSlug)
  const applicationFlows = applicationFlowsQuery.data ?? []
  const directFlows = directFlowsQuery.data ?? []
  const upsaleFlows = upsaleFlowsQuery.data ?? []
  const primaryFlowSlug = primaryFlowQuery.data?.flow_slug ?? null
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
    primaryFlowSlug: hasTicketAccess ? primaryFlowSlug : null,
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
    primaryFlowId:
      eligibleFlows.find((flow) => flow.slug === primaryFlowSlug)?.id ?? null,
  })
  const primaryFlowId =
    eligibleFlows.find((flow) => flow.slug === primaryFlowSlug)?.id ?? null

  const personalTickets = projectPersonalTickets(
    personalTicketsQuery.data ?? [],
    popupId ?? "",
  )
  const representedAttendeeIds = new Set(
    (attendeesQuery.data ?? []).map((attendee) => attendee.id),
  )
  if (participation?.type === "companion" && participation.attendee?.id) {
    representedAttendeeIds.add(participation.attendee.id)
  }
  const supplementalTickets = projectPersonalTickets(
    personalTicketsQuery.data ?? [],
    popupId ?? "",
    representedAttendeeIds,
  )
  const hasPersonalTickets = personalTickets.length > 0
  const personalReadFailed =
    personalTicketsQuery.isError && personalTicketsQuery.data === undefined

  useEffect(() => {
    if (
      !nobodyApplies &&
      access.state === "denied" &&
      !personalTicketsQuery.isLoading &&
      !personalReadFailed &&
      !hasPersonalTickets
    ) {
      router.replace(`/portal/${params.popupSlug}`)
    }
  }, [
    access.state,
    nobodyApplies,
    params.popupSlug,
    router,
    personalTicketsQuery.isLoading,
    personalReadFailed,
    hasPersonalTickets,
  ])

  if (!city || access.state === "loading" || personalTicketsQuery.isLoading)
    return <Loader />

  const personalTicketContent = personalReadFailed ? (
    <div role="alert" className="rounded-xl border border-border bg-card p-5">
      <p className="text-sm text-pass-text">
        {t("passes.personal_tickets_error")}
      </p>
      <Button
        variant="outline"
        className="mt-3"
        onClick={() => personalTicketsQuery.refetch()}
        disabled={personalTicketsQuery.isFetching}
      >
        <RefreshCw className="size-4" />
        {t("passes.error_retry", { defaultValue: "Try again" })}
      </Button>
    </div>
  ) : (
    <PersonalTicketPasses attendees={supplementalTickets} />
  )

  // A personal read allows displaying the pass, not purchasing or editing an
  // attendee. Keep email-matched rows out of the provider/checkout data entirely.
  if (!nobodyApplies && access.state === "denied") {
    if (!hasPersonalTickets && !personalReadFailed) return <Loader />
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        {personalReadFailed ? (
          personalTicketContent
        ) : (
          <PersonalTicketPasses attendees={personalTickets} />
        )}
      </div>
    )
  }

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
        <div className="mt-6">{personalTicketContent}</div>
      </div>
    )
  }

  const getPurchasePath = (attendee?: AttendeePassState) => {
    const flowSlug = resolvePassPurchaseFlowSlug({
      explicitFlowIdentifier,
      attendeeApplicationId: attendee?.application_id,
      primaryFlowId,
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
  const unassignedPurchaseAttendee = groupedPasses.unassignedAttendees[0]
  const unassignedPurchaseSlug = unassignedPurchaseAttendee
    ? resolvePassPurchaseFlowSlug({
        explicitFlowIdentifier,
        attendeeApplicationId: unassignedPurchaseAttendee.application_id,
        primaryFlowId,
        applications: purchaseApplications,
        eligibleFlows,
        eligibleApplicationFlows,
        eligibleDirectFlows,
      })
    : null
  const unassignedPurchaseFlow = eligibleFlows.find(
    (flow) => flow.slug === unassignedPurchaseSlug,
  )
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
    upsaleFlowsQuery.isLoading ||
    primaryFlowQuery.isLoading
  ) {
    return <Loader />
  }

  if (paymentsQuery.isLoading) return <Loader />

  // Do not tell a ticketless primary row to buy a pass when this account
  // already holds a personal spouse ticket. This only changes presentation.
  const personalEmails = new Set(
    supplementalTickets
      .map((attendee) => (attendee.email ?? "").trim().toLowerCase())
      .filter(Boolean),
  )
  const displayAttendees = (rows: AttendeePassState[]) =>
    supplementalTickets.length > 0
      ? rows.filter(
          (attendee) =>
            !personalEmails.has((attendee.email ?? "").trim().toLowerCase()) ||
            (attendee.ticket_entries ?? []).length > 0 ||
            attendee.products.some((product) => product.purchased),
        )
      : rows
  const unassignedDisplayAttendees = displayAttendees(
    groupedPasses.unassignedAttendees,
  )
  const passSections = [
    ...groupedPasses.sections.map(({ flow, attendees: flowAttendees }) => ({
      id: flow.id,
      title: flow.name,
      attendees: displayAttendees(flowAttendees),
      salesFlowId: flow.id,
      onSwitchToBuy: () =>
        router.push(`/portal/${params.popupSlug}/shop/${flow.slug}`),
    })),
    ...(unassignedDisplayAttendees.length > 0
      ? [
          {
            id: "other",
            title: t("passes.other_passes"),
            attendees: unassignedDisplayAttendees,
            salesFlowId: unassignedPurchaseFlow?.id ?? null,
            onSwitchToBuy: unassignedPurchaseFlow
              ? (attendee?: AttendeePassState) =>
                  openPurchase(attendee ?? unassignedPurchaseAttendee)
              : undefined,
          },
        ]
      : []),
  ].filter((section) => section.attendees.length > 0)
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

  if (
    passSections.length === 0 &&
    otherProducts.length === 0 &&
    supplementalTickets.length === 0 &&
    !personalReadFailed
  )
    return emptyState

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
        {(supplementalTickets.length > 0 || personalReadFailed) && (
          <div className="mb-8">{personalTicketContent}</div>
        )}
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
              popupId={popupId}
              catalog={products}
            />
          </div>
        )}
      </div>
    </div>
  )
}
