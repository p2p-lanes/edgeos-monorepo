// Deliberately independent of the generated admin SDK. Each entry is a Portal
// consumer surface; a new backend route is not automatically exposed here.
const POLICIES: Record<string, readonly RegExp[]> = {
  GET: [
    /^humans\/me(?:\/profile-stats)?$/,
    /^humans\/portal\/search$/,
    /^applications\/my\/(?:applications|tickets|participation\/[^/]+|directory\/[^/]+(?:\/csv)?)$/,
    /^attendees\/my\/popup\/[^/]+$/,
    /^carts\/my\/[^/]+$/,
    /^checkout\/[^/]+\/[^/]+\/(?:runtime|share|accommodations|cart)$/,
    /^payments\/my\/(?:latest|popup\/[^/]+|[^/]+\/(?:status|invoice))$/,
    /^groups\/my\/(?:groups|[^/]+)$/,
    /^groups\/public\/[^/]+$/,
    /^invites\/(?:redeem|preview)\/[^/]+$/,
    /^portal\/(?:invites|groups\/[^/]+|invite\/[^/]+|popup\/[^/]+\/access|popups\/[^/]+\/attendee-categories|accommodations)$/,
    /^api-keys$/,
    /^popups\/(?:public\/list|portal\/[^/]+)$/,
    /^products\/portal\/products$/,
    /^sales-flows\/portal(?:\/(?:upsale|direct))?$/,
    /^ticketing-steps\/portal$/,
    /^form-fields\/portal\/schema\/[^/]+$/,
    /^check-ins\/my\/[^/]+\/options$/,
    /^events\/public\/(?:calendar(?:\.ics)?|events\/[^/]+\/share)$/,
    /^events\/portal\/popup-tags\/[^/]+$/,
    /^events\/portal\/events(?:\/[^/]+(?:\/(?:invitations|admin-notes|ics))?)?$/,
    /^event-participants\/portal\/(?:participants|attendee-emails)$/,
    /^event-venues\/portal\/venues(?:\/[^/]+\/availability)?$/,
    /^event-settings\/portal\/settings\/[^/]+$/,
    /^tracks\/portal\/tracks$/,
    /^venue-property-types\/portal$/,
    /^tenants\/public\/(?:[^/]+|by-domain\/[^/]+)$/,
  ],
  POST: [
    /^applications\/my(?:\/detach-companion)?$/,
    /^attendees\/my\/popup\/[^/]+$/,
    /^checkout\/[^/]+\/[^/]+\/(?:preview|purchase|pending\/release|accommodations\/availability)$/,
    /^portal\/accommodations\/availability$/,
    /^coupons\/(?:validate|validate-public)$/,
    /^payments\/my(?:\/(?:application-fee|pending\/release|preview))?$/,
    /^groups\/my\/[^/]+\/members(?:\/batch)?$/,
    /^invites\/redeem\/[^/]+$/,
    /^portal\/invites$/,
    /^api-keys$/,
    /^uploads\/portal\/presigned-url$/,
    /^check-ins\/my\/[^/]+$/,
    /^events\/portal\/events(?:\/(?:check-availability|[^/]+\/(?:invitations|hide|cancel)))?$/,
    /^event-participants\/portal\/(?:register|cancel-registration|check-in)\/[^/]+$/,
    /^event-venues\/portal\/venues$/,
  ],
  PATCH: [
    /^humans\/me$/,
    /^applications\/my\/[^/]+$/,
    /^attendees\/my\/popup\/[^/]+\/[^/]+(?:\/tickets\/[^/]+\/meal-plan)?$/,
    /^groups\/my\/[^/]+$/,
    /^events\/portal\/events\/[^/]+$/,
    /^event-venues\/portal\/venues\/[^/]+$/,
  ],
  PUT: [
    /^events\/portal\/events\/[^/]+\/admin-notes$/,
    /^carts\/my\/[^/]+$/,
    /^checkout\/[^/]+\/[^/]+\/cart$/,
    /^groups\/my\/[^/]+\/members\/[^/]+$/,
  ],
  DELETE: [
    /^carts\/my\/[^/]+$/,
    /^attendees\/my\/popup\/[^/]+\/[^/]+$/,
    /^groups\/my\/[^/]+\/members\/[^/]+$/,
    /^portal\/invites\/[^/]+$/,
    /^api-keys\/[^/]+$/,
    /^events\/portal\/events\/[^/]+\/(?:hide|invitations\/[^/]+)$/,
  ],
}

export function allowedPortalPath(method: string, segments: string[]): boolean {
  // No percent-encoding, empty/dot segments, slashes or alternate separators.
  // Dots between labels support tenant domains and calendar/CSV suffixes.
  if (
    !segments.length ||
    segments.some(
      (segment) => !/^[a-zA-Z0-9_-]+(?:\.[a-zA-Z0-9_-]+)*$/.test(segment),
    )
  )
    return false
  return (
    POLICIES[method]?.some((pattern) => pattern.test(segments.join("/"))) ??
    false
  )
}

export function allowsPreview(method: string, path: string): boolean {
  return (
    method === "GET" &&
    /^checkout\/[^/]+\/[^/]+\/(?:runtime|accommodations(?:\/availability)?)$/.test(
      path,
    )
  )
}
