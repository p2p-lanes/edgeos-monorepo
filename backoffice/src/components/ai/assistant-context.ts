export type AssistantContextConfig = {
  pageLabel: string
  suggestions: string[]
  placeholder: string
}

const DEFAULT_CONTEXT: AssistantContextConfig = {
  pageLabel: "Dashboard",
  suggestions: [
    "What needs my attention in this gathering?",
    "Summarize today's activity",
    "Help me plan the next operational step",
  ],
  placeholder: "Ask about this gathering…",
}

const CONTEXTS: Array<{
  match: RegExp
  config: AssistantContextConfig
}> = [
  {
    match: /^\/applications(?:\/|$)/,
    config: {
      pageLabel: "Applications",
      suggestions: [
        "Summarize the applications waiting for review",
        "Show applicants with no reviews yet",
        "Find an application by name or email",
      ],
      placeholder: "Ask about applications…",
    },
  },
  {
    match: /^\/attendees(?:\/|$)/,
    config: {
      pageLabel: "Attendees",
      suggestions: [
        "Find an attendee by name or email",
        "Show attendees who still need to check in",
        "Assign a product to an attendee",
      ],
      placeholder: "Ask about attendees…",
    },
  },
  {
    match: /^\/products(?:\/|$)/,
    config: {
      pageLabel: "Products",
      suggestions: [
        "Show products with low stock",
        "Compare active product sales",
        "Find a product and summarize its availability",
      ],
      placeholder: "Ask about products…",
    },
  },
  {
    match: /^\/payments(?:\/|$)/,
    config: {
      pageLabel: "Payments",
      suggestions: [
        "Find recent failed payments",
        "Summarize today's payment activity",
        "Look up a payment by email or reference",
      ],
      placeholder: "Ask about payments…",
    },
  },
  {
    match: /^\/events(?:\/|$)/,
    config: {
      pageLabel: "Events",
      suggestions: [
        "Summarize the event schedule",
        "Find events missing a venue",
        "Create and configure an event for this gathering",
      ],
      placeholder: "Ask about events…",
    },
  },
  {
    match: /^\/humans(?:\/|$)/,
    config: {
      pageLabel: "Humans",
      suggestions: [
        "Find a person by name or email",
        "Show people marked for attention",
        "Summarize a person's gathering history",
      ],
      placeholder: "Ask about people…",
    },
  },
  {
    match: /^\/groups(?:\/|$)/,
    config: {
      pageLabel: "Groups",
      suggestions: [
        "Summarize the groups in this gathering",
        "Find a group and list its members",
        "Show groups that need attention",
      ],
      placeholder: "Ask about groups…",
    },
  },
  {
    match: /^\/check-in(?:\/|$)/,
    config: {
      pageLabel: "Check In",
      suggestions: [
        "Find an attendee's check-in status",
        "Summarize today's check-ins",
        "Show attendees still waiting to check in",
      ],
      placeholder: "Ask about check-in…",
    },
  },
]

export function assistantContextForPath(pathname: string) {
  const config =
    CONTEXTS.find(({ match }) => match.test(pathname))?.config ??
    DEFAULT_CONTEXT
  if (/^\/applications\/[^/]+$/.test(pathname)) {
    return { ...config, pageLabel: "Application details" }
  }
  if (/^\/attendees\/[^/]+$/.test(pathname)) {
    return { ...config, pageLabel: "Attendee details" }
  }
  if (/^\/events\/[^/]+$/.test(pathname)) {
    return { ...config, pageLabel: "Event details" }
  }
  return config
}
