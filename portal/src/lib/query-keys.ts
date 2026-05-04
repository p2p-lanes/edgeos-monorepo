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
  },
  formSchema: {
    portal: (popupId: string) => ["form-schema", "portal", popupId] as const,
  },
  checkout: {
    runtime: (slug: string) => ["checkout", "runtime", slug] as const,
    coupon: (slug: string, code: string) =>
      ["checkout", "coupon", slug, code] as const,
  },
} as const
