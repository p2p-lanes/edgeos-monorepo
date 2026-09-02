"use client"

import { dedupTicketEntries } from "@/app/portal/[popupSlug]/passes/utils/dedupTickets"
import type {
  ApplicationPublic,
  AttendeeWithOriginPublic,
  HumanPublic,
} from "@/client"
import { sortAttendees } from "@/helpers/filters"
import { useAttendeeCategories } from "@/hooks/useAttendeeCategories"
import useAuth from "@/hooks/useAuth"
import useHumanAttendeesQuery from "@/hooks/useHumanAttendeesQuery"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import type { AttendeePassState } from "@/types/Attendee"
import {
  buildCheckoutRecipientDraft,
  type CheckoutRecipientPassState,
} from "@/types/checkout"

function buildHumanProfileSnapshot(
  user: HumanPublic,
  application: ApplicationPublic | null,
): Record<string, unknown> {
  return {
    ...(application?.custom_fields ?? {}),
    first_name: user.first_name ?? null,
    last_name: user.last_name ?? null,
    telegram: user.telegram ?? null,
    gender: user.gender ?? null,
    age: user.age ?? null,
    residence: user.residence ?? null,
    picture_url: user.picture_url ?? null,
    enriched_profile: user.enriched_profile ?? null,
  }
}

/**
 * Resolves the attendees list the PassesProvider should drive off.
 *
 * - Where nobody applies (`takes_applications === false`): uses persisted
 *   attendees after purchase and a synthetic "main" attendee before purchase.
 *
 * - Where applications exist: calls
 *   `GET /attendees/my/popup/{popup_id}` via `useHumanAttendeesQuery` and
 *   returns the unified flat list (application-linked + direct-sale attendees).
 *   This replaces the previous read of `application.attendees[]` through the
 *   ApplicationProvider aggregate.
 *
 * Queries without attendee data return an empty list. Retained data remains
 * usable when a background refetch fails.
 *
 * The list is not narrowed by door. A sales flow scopes configuration; the
 * popup scopes data, and people are data (sdd/sales-flows-rediseno). One
 * person is one attendee row at a gathering however many ways in they used,
 * so filing that row under the door it happened to be created through hid
 * the person from themselves everywhere else — a volunteer looking at their
 * passes saw their spouse and no sign of their own.
 */
export function useResolvedAttendees(
  salesFlowId?: string | null,
): CheckoutRecipientPassState[] {
  const { getCity } = useCityProvider()
  const { user } = useAuth()
  const { getRelevantApplication } = useApplication()

  const city = getCity()
  // Not "is this a direct-sale popup" any more: a gathering can take
  // applications through one door and sell through another, so what matters
  // here is whether anybody applies at all. Nobody does → there are no
  // attendee rows to read and the buyer is built from the logged-in human
  // (sdd/sales-flows-rediseno slice 6).
  const nobodyApplies = city?.takes_applications === false

  // Always call the hook — conditional hooks are forbidden by Rules of Hooks.
  // The hook disables the query when popupId is null/falsy or no human is logged in.
  const popupId = city ? String(city.id) : null
  const { data: humanAttendees } = useHumanAttendeesQuery(popupId)
  const { categories } = useAttendeeCategories(popupId ?? "")
  const application = nobodyApplies
    ? null
    : getRelevantApplication(salesFlowId ?? undefined)

  if (!humanAttendees) return []

  if (humanAttendees.length > 0) {
    const withTicketEntries = humanAttendees.map(
      (attendee: AttendeeWithOriginPublic): AttendeePassState => ({
        ...(attendee as unknown as AttendeePassState),
        products: [],
        ticket_entries: dedupTicketEntries(attendee.products ?? []),
      }),
    )
    return sortAttendees(withTicketEntries)
  }

  const primaryCategory = categories?.find((category) => category.is_primary)
  const hasUnambiguousApplication =
    application?.popup_id === city?.id && application?.human_id === user?.id

  if (
    city &&
    user &&
    primaryCategory &&
    (nobodyApplies || hasUnambiguousApplication)
  ) {
    const firstName = user.first_name?.trim() ?? ""
    const lastName = user.last_name?.trim() ?? ""
    const fullName = [firstName, lastName].filter(Boolean).join(" ").trim()
    const displayName = fullName || user.email
    const profileSnapshot = buildHumanProfileSnapshot(user, application)

    const virtualAttendee: CheckoutRecipientPassState = {
      id: user.id,
      tenant_id: user.tenant_id,
      popup_id: city.id,
      human_id: user.id,
      application_id: application?.id ?? null,
      name: displayName,
      category_id: primaryCategory.id,
      category: primaryCategory.key,
      email: user.email,
      gender: user.gender ?? null,
      poap_url: null,
      additional_data: profileSnapshot,
      created_at: null,
      updated_at: null,
      products: [],
    }

    return [
      {
        ...virtualAttendee,
        recipient: buildCheckoutRecipientDraft(virtualAttendee),
      },
    ]
  }

  return []
}

export default useResolvedAttendees
