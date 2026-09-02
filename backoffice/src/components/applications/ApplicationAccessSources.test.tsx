import { render, screen } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { ApplicationAccessSources } from "./ApplicationAccessSources"

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params,
    to,
  }: {
    children: ReactNode
    params: Record<string, string>
    to: string
  }) => {
    const href = Object.entries(params).reduce(
      (path, [key, value]) => path.replace(`$${key}`, value),
      to,
    )
    return <a href={href}>{children}</a>
  },
}))

describe("ApplicationAccessSources", () => {
  it("renders nothing when the application did not use an access link", () => {
    const { container } = render(<ApplicationAccessSources sources={[]} />)

    expect(container).toBeEmptyDOMElement()
  })

  it("renders every attributed source without choosing precedence", () => {
    render(
      <ApplicationAccessSources
        sources={[
          { kind: "group", id: "group-1", label: "Builders" },
          { kind: "invite", id: "invite-1", label: "vip-code" },
          { kind: "referral", id: "referral-1", label: "ada-code" },
        ]}
      />,
    )

    expect(screen.getByText("Builders")).toBeTruthy()
    expect(screen.getByRole("link", { name: "Builders" })).toHaveAttribute(
      "href",
      "/groups/group-1/edit",
    )
    expect(screen.getByRole("link", { name: "vip-code" })).toHaveAttribute(
      "href",
      "/invites/invite-1/edit",
    )
    expect(screen.getByRole("link", { name: "ada-code" })).toHaveAttribute(
      "href",
      "/invites/referral-1/edit",
    )
  })
})
