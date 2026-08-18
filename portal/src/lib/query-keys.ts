export const queryKeys = {
  popups: {
    portal: () => ["popups", "portal"] as const,
  },
  applications: {
    mine: () => ["applications", "mine"] as const,
  },
  products: {
    byPopup: (popupId: string) => ["products", popupId] as const,
  },
  attendees: {
    directory: (popupId: string) =>
      ["attendees", "directory", popupId] as const,
    byHumanPopup: (popupId: string) => ["attendees", "human", popupId] as const,
  },
  purchases: {
    byPopup: (popupId: string) => ["purchases", popupId] as const,
  },
  cart: {
    byPopup: (popupId: string) => ["cart", popupId] as const,
  },
  participation: {
    byPopup: (popupId: string) => ["participation", popupId] as const,
  },
  payments: {
    all: ["payments"] as const,
    byApp: (applicationId: string) => ["payments", applicationId] as const,
    byPopup: (popupId: string) => ["payments", "popup", popupId] as const,
  },
  humanPopupAccess: {
    byPopup: (popupId: string) => ["human-popup-access", popupId] as const,
  },
  groups: {
    mine: () => ["groups", "mine"] as const,
    detail: (groupId: string) => ["groups", "detail", groupId] as const,
    public: (slug: string) => ["groups", "public", slug] as const,
  },
  profile: {
    current: ["profile", "current"] as const,
    stats: ["profile", "stats"] as const,
  },
  formSchema: {
    // `salesFlowId` (sdd/sales-flows D6 URL scheme, task 9.4) is part of the
    // identity — a named flow's schema must never be served from the
    // default flow's cache entry.
    portal: (popupId: string, salesFlowId?: string | null) =>
      salesFlowId
        ? (["form-schema", "portal", popupId, salesFlowId] as const)
        : (["form-schema", "portal", popupId] as const),
  },
  checkout: {
    // The runtime payload is translated server-side from Accept-Language, so
    // the language is part of the cache identity. `flowSlug` (sdd/sales-flows
    // D6 URL scheme) is part of the identity too — a named flow's runtime
    // must never be served from the default flow's cache entry, or vice
    // versa. Both dimensions are labeled keys of a trailing filter object
    // (not positional slots) so a flow slugged e.g. "es" can never collide
    // with the "es" language, and `runtime(slug)` alone still yields `{}` —
    // a filter that partially matches every flow/lang variant for broad
    // invalidation (see checkoutProvider.tsx).
    runtime: (slug: string, flowSlug?: string | null, lang?: string | null) => {
      const filter: { flowSlug?: string; lang?: string } = {}
      if (flowSlug) filter.flowSlug = flowSlug
      if (lang) filter.lang = lang
      return ["checkout", "runtime", slug, filter] as const
    },
    coupon: (slug: string, code: string) =>
      ["checkout", "coupon", slug, code] as const,
  },
  attendeeCategories: {
    byPopup: (popupId: string) => ["attendee-categories", popupId] as const,
  },
  salesFlows: {
    portal: (popupId: string) => ["sales-flows", "portal", popupId] as const,
    portalDirect: (popupId: string) =>
      ["sales-flows", "portal", "direct", popupId] as const,
    portalUpsale: (popupId: string) =>
      ["sales-flows", "portal", "upsale", popupId] as const,
  },
} as const
