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

  it("builds the portal application entry path for an application flow", () => {
    expect(
      getSalesFlowUrl("https://demo.edgeos.world", "spring-fest", {
        type: "application",
        slug: "default",
      }),
    ).toBe("https://demo.edgeos.world/portal/spring-fest/application")
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

  it("renders the portal application entry note for application flows", () => {
    render(
      <SalesFlowUrlCard
        portalBaseUrl="https://demo.edgeos.world"
        popupSlug="spring-fest"
        flow={{ type: "application", slug: "default" }}
      />,
    )

    expect(
      screen.getByText(
        "https://demo.edgeos.world/portal/spring-fest/application",
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/portal's flow picker/i)).toBeInTheDocument()
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
