import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { getSalesFlowUrl, SalesFlowUrlCard } from "./SalesFlowUrlCard"

describe("getSalesFlowUrl", () => {
  it("builds the checkout path for a direct flow", () => {
    expect(
      getSalesFlowUrl("https://demo.edgeos.world", "spring-fest", {
        type: "direct",
        slug: "vip-pass",
      }),
    ).toBe("https://demo.edgeos.world/checkout/spring-fest/vip-pass")
  })

  it("builds the checkout path for an upsale flow", () => {
    expect(
      getSalesFlowUrl("https://demo.edgeos.world", "spring-fest", {
        type: "upsale",
        slug: "add-workshop",
      }),
    ).toBe("https://demo.edgeos.world/checkout/spring-fest/add-workshop")
  })

  it("builds the portal application entry path with the application's flow slug", () => {
    expect(
      getSalesFlowUrl("https://demo.edgeos.world", "spring-fest", {
        type: "application",
        slug: "attendee",
      }),
    ).toBe(
      "https://demo.edgeos.world/portal/spring-fest/application?flow=attendee",
    )
  })
})

describe("SalesFlowUrlCard", () => {
  it("renders the direct flow URL with copy and open actions", () => {
    render(
      <SalesFlowUrlCard
        portalBaseUrl="https://demo.edgeos.world"
        popupSlug="spring-fest"
        flow={{ type: "direct", slug: "vip-pass" }}
      />,
    )

    expect(
      screen.getByText(
        "https://demo.edgeos.world/checkout/spring-fest/vip-pass",
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: /copy link/i }),
    ).toBeInTheDocument()
    const openLink = screen.getByRole("link", { name: /open link/i })
    expect(openLink).toHaveAttribute(
      "href",
      "https://demo.edgeos.world/checkout/spring-fest/vip-pass",
    )
  })

  it("renders the flow-specific portal application entry link", () => {
    render(
      <SalesFlowUrlCard
        portalBaseUrl="https://demo.edgeos.world"
        popupSlug="spring-fest"
        flow={{ type: "application", slug: "attendee" }}
      />,
    )

    expect(
      screen.getByText(
        "https://demo.edgeos.world/portal/spring-fest/application?flow=attendee",
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/opens this application flow/i)).toBeInTheDocument()
  })

  it("disables the actions and explains the missing link when there is no portal domain", () => {
    render(
      <SalesFlowUrlCard
        portalBaseUrl={null}
        popupSlug="spring-fest"
        flow={{ type: "direct", slug: "vip-pass" }}
      />,
    )

    expect(
      screen.getByText(/set a portal domain for this organization/i),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: /copy link/i })).toBeDisabled()
    expect(screen.getByRole("button", { name: /open link/i })).toBeDisabled()
  })
})
