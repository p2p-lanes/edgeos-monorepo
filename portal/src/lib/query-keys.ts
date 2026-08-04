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
    // the language is part of the cache identity. Omitting `lang` yields the
    // language-agnostic prefix, which still matches every language's entry for
    // invalidation. `flowSlug` (sdd/sales-flows D6 URL scheme) is part of the
    // identity too — a named flow's runtime must never be served from the
    // default flow's cache entry, or vice versa.
    runtime: (slug: string, flowSlug?: string | null, lang?: string | null) => {
      if (flowSlug && lang) {
        return ["checkout", "runtime", slug, flowSlug, lang] as const
      }
      if (flowSlug) {
        return ["checkout", "runtime", slug, flowSlug] as const
      }
      if (lang) {
        return ["checkout", "runtime", slug, lang] as const
      }
      return ["checkout", "runtime", slug] as const
    },
    coupon: (slug: string, code: string) =>
      ["checkout", "coupon", slug, code] as const,
  },
  attendeeCategories: {
    byPopup: (popupId: string) => ["attendee-categories", popupId] as const,
  },
  salesFlows: {
    portal: (popupId: string) => ["sales-flows", "portal", popupId] as const,
  },
} as const
