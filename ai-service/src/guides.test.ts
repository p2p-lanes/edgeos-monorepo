import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"
import { GuideRegistry, parseGuide, routeMatches } from "./guides.js"
import { buildSystemPrompt, CANNOT_DO_SENTENCE } from "./system-prompt.js"

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const backofficeSrc = join(repoRoot, "backoffice", "src")

// Full paths the backoffice router knows, e.g. "/applications/$id".
function backofficeRoutes() {
  const source = readFileSync(join(backofficeSrc, "routeTree.gen.ts"), "utf8")
  const block =
    source.match(/interface FileRoutesByFullPath \{([\s\S]*?)\n\}/)?.[1] ?? ""
  return new Set(
    [...block.matchAll(/'([^']+)':/g)].map(
      (match) => (match[1] ?? "").replace(/(.)\/$/, "$1") || "/",
    ),
  )
}

function linkedRoutes(markdown: string) {
  return [...markdown.matchAll(/\]\((\/[^)\s]*)\)/g)].map(
    (match) => match[1] ?? "",
  )
}

const registry = new GuideRegistry()

beforeAll(async () => {
  await registry.load()
})

describe("backoffice guides content", () => {
  it("loads the navigation map and every guide", () => {
    expect(registry.navigationMap()).toContain("## Sidebar")
    expect(registry.all().length).toBeGreaterThanOrEqual(20)
    for (const guide of registry.all()) {
      expect(guide.triggers.length, guide.name).toBeGreaterThan(3)
      expect(guide.instructions, guide.name).toContain("**Where:**")
    }
  })

  it("only references routes that exist in the backoffice", () => {
    const routes = backofficeRoutes()
    expect(routes.has("/applications")).toBe(true)
    const referenced = [
      ...linkedRoutes(registry.navigationMap()),
      ...registry
        .all()
        .flatMap((guide) => [
          ...guide.routes,
          ...linkedRoutes(guide.instructions),
        ]),
    ]
    const missing = referenced
      .map((route) => route.split("?")[0] ?? route)
      .filter((route) => !routes.has(route))
    expect(missing).toEqual([])
  })

  it("documents every sidebar item in the navigation map", () => {
    const sidebar = readFileSync(
      join(backofficeSrc, "components", "Sidebar", "AppSidebar.tsx"),
      "utf8",
    )
    const items = [
      ...sidebar.matchAll(/title: "([^"]+)",\s*path: [`"]([^`"]+)[`"]/g),
    ].map((match) => ({
      title: match[1] ?? "",
      path: (match[2] ?? "").replace(/\$\{tenantId\}/, "$id"),
    }))
    expect(items.length).toBeGreaterThan(25)
    const navigation = registry.navigationMap()
    // API Keys is hidden behind SHOW_AGENTIC_ACCESS and intentionally absent.
    const missing = items
      .filter((item) => item.path !== "/api-keys")
      .filter((item) => !navigation.includes(`"${item.title}" → ${item.path}`))
    expect(missing).toEqual([])
  })

  it("lists unavailable capabilities with the exact refusal sentence", () => {
    const navigation = registry.navigationMap()
    expect(navigation).toContain(CANNOT_DO_SENTENCE)
    expect(navigation).toMatch(/Refunding a payment/)
  })
})

describe("guide search", () => {
  const top = (query: string, pathname?: string) =>
    registry.search(query, { pathname })[0]?.guide.name

  it.each([
    ["where can I find the applications?", "find-applications"],
    [
      "how do I grant a free ticket to an attendee?",
      "grant-swap-remove-ticket",
    ],
    [
      "how do I change someone's pass to another product",
      "grant-swap-remove-ticket",
    ],
    ["upload a csv to give tickets to many people", "bulk-grant-tickets"],
    ["how do I refund a payment in EdgeOS?", "payments"],
    ["how do I scan QR codes at the door", "check-in"],
    ["share a link with the coupon applied", "coupons-and-coupon-links"],
    [
      "why isn't my product showing in the checkout",
      "checkout-ticketing-steps",
    ],
    ["add a teammate as admin", "roles-and-users"],
    [
      "approve events submitted by attendees",
      "approve-events-and-event-settings",
    ],
    ["¿dónde están las aplicaciones?", "find-applications"],
  ])("routes %s to %s", (query, guide) => {
    expect(top(query)).toBe(guide)
  })

  it("boosts guides for the current page", () => {
    const [onAttendee] = registry.search("how do I add one", {
      pathname: "/attendees/123e4567",
    })
    expect(onAttendee?.guide.routes).toContain("/attendees/$attendeeId")
  })

  it("injects only confident matches into the prompt", () => {
    expect(registry.relevantInstructions("hello there")).toContain(
      "No usage guide matched",
    )
    expect(
      registry.relevantInstructions("how do I grant a ticket to Ana?"),
    ).toContain("## Guide: grant-swap-remove-ticket")
  })
})

describe("guide helpers", () => {
  it("matches parameterized routes", () => {
    expect(routeMatches("/attendees/$attendeeId", "/attendees/abc")).toBe(true)
    expect(routeMatches("/attendees/$attendeeId", "/attendees")).toBe(false)
    expect(
      routeMatches("/popups/$id/edit?tab=features", "/popups/x/edit"),
    ).toBe(true)
  })

  it("parses guide frontmatter", () => {
    const guide = parseGuide(
      "---\nname: demo\ndescription: Demo guide\ntriggers: Grant Ticket,dar entrada\nroutes: /attendees\nroles: admin\n---\n**Where:** here",
    )
    expect(guide).toMatchObject({
      name: "demo",
      triggers: ["grant ticket", "dar entrada"],
      routes: ["/attendees"],
      roles: "admin",
    })
  })
})

describe("system prompt guidance", () => {
  it("includes the navigation map, language and refusal rules", () => {
    const prompt = buildSystemPrompt(
      {
        authorization: "Bearer token",
        tenantId: "tenant-1",
        pathname: "/attendees",
        user: { id: "u", email: "a@example.com", role: "operator" },
      },
      "No additional workflow.",
      undefined,
      { navigation: registry.navigationMap(), relevant: "No guide." },
    )
    expect(prompt).toContain("## Guiding users through the backoffice")
    expect(prompt).toContain(`"${CANNOT_DO_SENTENCE}"`)
    expect(prompt).toContain("Always reply in the language the user writes in")
    expect(prompt).toContain('"EdgeOS" is the product name')
    expect(prompt).toContain('"Applications" → /applications')
  })
})
