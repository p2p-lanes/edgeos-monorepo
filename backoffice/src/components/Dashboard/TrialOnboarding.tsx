// ──────────────────────────────────────────────────────────────────────────
// TrialOnboarding — replaces the dashboard for free-trial tenants.
//
// A guided checklist of everything a new organizer should set up, in order.
// Each step's completion is detected from real data (cheap `limit: 1` list
// calls + fields the trial provisioning leaves empty — see
// backend/app/api/trial/crud.py: the tenant and the draft popup start with
// only a name). Nothing is stored client-side except the "skip" dismissal.
// ──────────────────────────────────────────────────────────────────────────

import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type { LucideIcon } from "lucide-react"
import {
  ArrowRight,
  Building2,
  CalendarPlus,
  Check,
  ListOrdered,
  MapPin,
  Package,
  Palette,
  PartyPopper,
  Settings2,
  Tent,
} from "lucide-react"

import {
  ApiError,
  EventSettingsService,
  EventsService,
  EventVenuesService,
  PopupsService,
  ProductsService,
  type TenantPublic,
  TicketingStepsService,
} from "@/client"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

interface OnboardingStep {
  key: string
  icon: LucideIcon
  title: string
  description: string
  to: string
  params?: Record<string, string>
  done: boolean | undefined // undefined = still loading
}

export function TrialOnboarding({
  tenant,
  onSkip,
}: {
  tenant: TenantPublic
  onSkip: () => void
}) {
  const { user: currentUser } = useAuth()
  const { selectedPopupId, effectiveTenantId } = useWorkspace()

  // The trial provisions exactly one draft popup; selectedPopupId resolves to
  // it automatically via the workspace context.
  const popupId = selectedPopupId

  const { data: popup } = useQuery({
    queryKey: ["popups", popupId],
    queryFn: () => PopupsService.getPopup({ popupId: popupId! }),
    enabled: !!popupId,
  })

  const { data: products } = useQuery({
    queryKey: ["onboarding", "products", popupId],
    queryFn: () => ProductsService.listProducts({ popupId, limit: 1 }),
    enabled: !!popupId,
  })

  const { data: ticketingSteps } = useQuery({
    queryKey: ["onboarding", "ticketing-steps", popupId],
    queryFn: () =>
      TicketingStepsService.listTicketingSteps({ popupId, limit: 1 }),
    enabled: !!popupId,
  })

  // GET /event-settings/{popupId} 404s until the organizer saves them once —
  // that 404 IS the "not configured yet" signal, so don't retry on it.
  const eventSettings = useQuery({
    queryKey: ["onboarding", "event-settings", popupId],
    queryFn: () => EventSettingsService.getEventSettings({ popupId: popupId! }),
    enabled: !!popupId,
    retry: (failureCount, error) =>
      !(error instanceof ApiError && error.status === 404) && failureCount < 2,
  })

  const { data: venues } = useQuery({
    queryKey: ["onboarding", "venues", popupId],
    queryFn: () => EventVenuesService.listVenues({ popupId, limit: 1 }),
    enabled: !!popupId,
  })

  const { data: events } = useQuery({
    queryKey: ["onboarding", "events", popupId],
    queryFn: () => EventsService.listEvents({ popupId, limit: 1 }),
    enabled: !!popupId,
  })

  // Trial provisioning creates the tenant with only a name — any branding /
  // sender field present means the organizer has been through the form.
  const orgEdited =
    !!tenant.logo_url ||
    !!tenant.image_url ||
    !!tenant.icon_url ||
    !!tenant.sender_email ||
    !!tenant.sender_name

  // Same idea for the draft popup: it starts as just a name.
  const popupEdited = popup
    ? !!popup.tagline ||
      !!popup.location ||
      !!popup.start_date ||
      !!popup.end_date ||
      !!popup.image_url
    : undefined

  const steps: OnboardingStep[] = [
    {
      key: "organization",
      icon: Building2,
      title: "Edit your organization",
      description:
        "Add your logo and sender details — this is the identity your attendees will see on emails and the portal.",
      to: "/organizations/$id/edit",
      params: { id: effectiveTenantId ?? "" },
      done: orgEdited,
    },
    {
      key: "gathering",
      icon: Tent,
      title: "Edit your first gathering",
      description: `A gathering is one edition of your event. We already created "${popup?.name ?? tenant.name}" for you — add its dates, location and imagery.`,
      to: "/popups/$id/edit",
      params: { id: popupId ?? "" },
      done: popupEdited,
    },
    {
      key: "products",
      icon: Package,
      title: "Create your products",
      description:
        "Products are what attendees purchase: access tickets, housing, add-ons. Later you can arrange purchase funnels around them.",
      to: "/products",
      done: products ? products.paging.total > 0 : undefined,
    },
    {
      key: "ticketing-steps",
      icon: ListOrdered,
      title: "Set up ticketing steps",
      description:
        "Define the steps attendees walk through when getting their tickets.",
      to: "/ticketing-steps",
      done: ticketingSteps ? ticketingSteps.paging.total > 0 : undefined,
    },
    {
      key: "theme",
      icon: Palette,
      title: "Configure your portal theme",
      description:
        "Pick the colors, fonts and branding of the portal your attendees will visit.",
      to: "/theme",
      done: popup ? popup.theme_config != null : undefined,
    },
    {
      key: "event-settings",
      icon: Settings2,
      title: "Configure event settings",
      description:
        "Set the defaults for your schedule: approval strategy, tags and notifications.",
      to: "/events/settings",
      done: eventSettings.isSuccess
        ? true
        : eventSettings.isError
          ? false
          : undefined,
    },
    {
      key: "venues",
      icon: MapPin,
      title: "Create your venues",
      description: "Add the places where your sessions will happen.",
      to: "/events/venues",
      done: venues ? venues.paging.total > 0 : undefined,
    },
    {
      key: "event",
      icon: CalendarPlus,
      title: "Create your first event",
      description: "Publish the first session on your gathering's schedule.",
      to: "/events/new",
      done: events ? events.paging.total > 0 : undefined,
    },
  ]

  const doneCount = steps.filter((s) => s.done === true).length
  const allDone = steps.every((s) => s.done === true)
  const progressPct = Math.round((doneCount / steps.length) * 100)

  const daysLeft = tenant.trial_expires_at
    ? Math.max(
        0,
        Math.ceil(
          (new Date(tenant.trial_expires_at).getTime() - Date.now()) /
            86_400_000,
        ),
      )
    : null

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">
          Welcome, {currentUser?.full_name || currentUser?.email}
        </h1>
        <p className="text-muted-foreground text-sm">
          Let's get {popup?.name ?? tenant.name} up and running. Complete these
          steps in order — each one unlocks a piece of your gathering.
          {daysLeft !== null && (
            <>
              {" "}
              You have{" "}
              <span className="font-medium text-foreground">
                {daysLeft} day{daysLeft !== 1 ? "s" : ""}
              </span>{" "}
              left on your trial.
            </>
          )}
        </p>
      </div>

      {/* Progress */}
      <div className="flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <span className="shrink-0 text-xs font-medium text-muted-foreground">
          {doneCount} of {steps.length} completed
        </span>
      </div>

      {/* All-done banner */}
      {allDone && (
        <Card className="border-success/40 bg-success/5 py-0">
          <CardContent className="flex items-center gap-3 p-4">
            <PartyPopper className="h-5 w-5 shrink-0 text-success" />
            <div className="flex-1">
              <p className="text-sm font-medium">You're all set!</p>
              <p className="text-xs text-muted-foreground">
                Your gathering is fully configured. Head to the dashboard to
                follow applications, sales and attendance.
              </p>
            </div>
            <Button size="sm" onClick={onSkip}>
              Go to dashboard
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Steps */}
      <div className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <Link key={step.key} to={step.to} params={step.params}>
            <Card
              className={cn(
                "cursor-pointer py-0 transition-colors hover:bg-muted/50",
                step.done && "opacity-70",
              )}
            >
              <CardContent className="flex items-center gap-4 p-4">
                {/* Status circle */}
                {step.done === undefined ? (
                  <Skeleton className="h-8 w-8 shrink-0 rounded-full" />
                ) : step.done ? (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
                    <Check className="h-4 w-4" />
                  </div>
                ) : (
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-muted-foreground/30 text-sm font-semibold text-muted-foreground">
                    {i + 1}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "flex items-center gap-2 text-sm font-medium",
                      step.done &&
                        "line-through decoration-muted-foreground/50",
                    )}
                  >
                    <step.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {step.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {step.description}
                  </p>
                </div>

                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {/* Skip */}
      {!allDone && (
        <button
          type="button"
          onClick={onSkip}
          className="self-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Skip for now — go to the dashboard
        </button>
      )}
    </div>
  )
}
