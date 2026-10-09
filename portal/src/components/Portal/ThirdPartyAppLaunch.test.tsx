import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { StrictMode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ThirdPartyAppLaunch } from "./ThirdPartyAppLaunch"

const mocks = vi.hoisted(() => ({
  launch: vi.fn(),
  issue: vi.fn(),
  query:
    "state=abcdefghijklmnop&code_challenge=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG&code_challenge_method=S256",
}))
vi.mock("@/client", async (original) => ({
  ...(await original<typeof import("@/client")>()),
  ThirdPartySsoService: {
    getSsoLaunch: mocks.launch,
    createSsoCode: mocks.issue,
  },
}))
vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: "test-popup", appId: "test-app" }),
  useSearchParams: () => new URLSearchParams(mocks.query),
}))
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (_: string, options: { defaultValue: string }) => options.defaultValue,
  }),
}))
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
  }: {
    href: string
    children: React.ReactNode
  }) => <a href={href}>{children}</a>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.launch.mockRejectedValue(new Error("Unavailable"))
  mocks.issue.mockRejectedValue(new Error("Invalid transaction"))
})
afterEach(cleanup)

describe("third-party app launch", () => {
  it("only loads launch metadata and shows a recoverable error", async () => {
    render(<ThirdPartyAppLaunch />)
    await screen.findByRole("heading", { name: "Could not open the app" })
    expect(mocks.launch).toHaveBeenCalledWith({
      slug: "test-popup",
      appId: "test-app",
    })
    expect(mocks.issue).not.toHaveBeenCalled()
    expect(
      screen.getByRole("link", { name: "Back to home" }).getAttribute("href"),
    ).toBe("/portal/test-popup")
  })
  it("passes state and PKCE to the authenticated code endpoint", async () => {
    render(<ThirdPartyAppLaunch authorize />)
    await screen.findByRole("heading", { name: "Could not open the app" })
    expect(mocks.issue).toHaveBeenCalledWith({
      slug: "test-popup",
      appId: "test-app",
      requestBody: {
        state: "abcdefghijklmnop",
        code_challenge: "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
        code_challenge_method: "S256",
      },
    })
    expect(mocks.launch).not.toHaveBeenCalled()
  })
  it("does not duplicate the issuance POST under StrictMode", async () => {
    render(
      <StrictMode>
        <ThirdPartyAppLaunch authorize />
      </StrictMode>,
    )
    await waitFor(() => expect(mocks.issue).toHaveBeenCalledTimes(1))
    await screen.findByRole("heading", { name: "Could not open the app" })
    expect(mocks.issue).toHaveBeenCalledTimes(1)
  })
})
