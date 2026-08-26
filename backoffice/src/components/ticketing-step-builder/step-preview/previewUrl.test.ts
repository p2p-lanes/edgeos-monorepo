import { describe, expect, it } from "vitest"

import type { TenantPublic } from "@/client"
import {
  getCheckoutPreviewUrl,
  previewOrigin,
  resolvePreviewTarget,
} from "./previewUrl"

function tenant(overrides: Partial<TenantPublic> = {}): TenantPublic {
  return {
    id: "tenant-1",
    name: "Demo",
    slug: "demo",
    custom_domain: null,
    custom_domain_active: false,
    ...overrides,
  } as TenantPublic
}

describe("getCheckoutPreviewUrl", () => {
  it("points at the portal's preview route", () => {
    expect(
      getCheckoutPreviewUrl("https://demo.edgeos.world", "my-event", "main"),
    ).toBe("https://demo.edgeos.world/checkout/my-event/preview?flow=main")
  })

  it("carries the language so the portal renders the translated copy", () => {
    expect(
      getCheckoutPreviewUrl(
        "https://demo.edgeos.world",
        "my-event",
        "main",
        "es",
      ),
    ).toBe(
      "https://demo.edgeos.world/checkout/my-event/preview?flow=main&lang=es",
    )
  })
})

describe("resolvePreviewTarget", () => {
  it("builds a URL on the tenant's custom domain when it is active", () => {
    const target = resolvePreviewTarget(
      tenant({
        custom_domain: "tickets.example.com",
        custom_domain_active: true,
      }),
      "my-event",
      "main",
    )

    expect(target.url).toBe(
      "https://tickets.example.com/checkout/my-event/preview?flow=main",
    )
  })

  it("builds a subdomain URL from the configured portal domain", () => {
    const target = resolvePreviewTarget(tenant(), "my-event", "main")

    // VITE_PORTAL_DOMAIN comes from backoffice/.env in this environment.
    expect(target.url).toContain("/checkout/my-event/preview")
  })

  it("points at the env var when no portal host can be derived", () => {
    const target = resolvePreviewTarget(
      tenant({ slug: "" }),
      "my-event",
      "main",
    )

    expect(target.url).toBeNull()
    expect(target.reason).toMatch(/VITE_PORTAL_DOMAIN/)
  })

  // A different failure with a different fix — naming the env var here would
  // send the reader after the wrong thing.
  it("says the tenant is missing rather than blaming config", () => {
    const target = resolvePreviewTarget(null, "my-event", "main")

    expect(target.url).toBeNull()
    expect(target.reason).toMatch(/tenant/i)
    expect(target.reason).not.toMatch(/VITE_PORTAL_DOMAIN/)
  })

  it("explains itself when the event has no slug", () => {
    const target = resolvePreviewTarget(
      tenant({
        custom_domain: "tickets.example.com",
        custom_domain_active: true,
      }),
      null,
      "main",
    )

    expect(target.url).toBeNull()
    expect(target.reason).toMatch(/slug/)
  })

  it("explains when no sales flow is selected", () => {
    const target = resolvePreviewTarget(tenant(), "my-event", null)

    expect(target.url).toBeNull()
    expect(target.reason).toMatch(/sales flow/i)
  })
})

describe("previewOrigin", () => {
  it("reduces the preview URL to the origin messages may be posted to", () => {
    expect(
      previewOrigin(
        "https://demo.edgeos.world/checkout/my-event/preview?lang=es",
      ),
    ).toBe("https://demo.edgeos.world")
  })
})
