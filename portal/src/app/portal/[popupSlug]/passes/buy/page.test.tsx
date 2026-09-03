import { render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  buyPassesContent: vi.fn(() => <div data-testid="buy-passes-content" />),
}))

vi.mock("next/navigation", () => ({
  useParams: () => ({ popupSlug: "tech-summit" }),
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => ({
    get: () => "93ae6465-4ca3-4f48-bfe3-6dfab9fa30a7",
  }),
}))

vi.mock("@/components/ui/Loader", () => ({
  Loader: () => <div data-testid="loader" />,
}))

vi.mock("@/hooks/useHumanPopupAccess", () => ({
  useHumanPopupAccess: () => ({ state: "allowed", source: "application" }),
}))

vi.mock("@/providers/cityProvider", () => ({
  useCityProvider: () => ({
    getCity: () => ({ id: "popup-1", takes_applications: true }),
  }),
}))

vi.mock("./components/BuyPassesContent", () => ({
  default: mocks.buyPassesContent,
}))

import BuyPassesPage from "./page"

describe("BuyPassesPage", () => {
  beforeEach(() => {
    mocks.replace.mockReset()
    mocks.buyPassesContent.mockClear()
  })

  it("delegates an authorized application flow UUID to BuyPassesContent without a Shop redirect", () => {
    render(<BuyPassesPage />)

    expect(screen.getByTestId("buy-passes-content")).toBeTruthy()
    expect(mocks.buyPassesContent).toHaveBeenCalledOnce()
    expect(mocks.replace).not.toHaveBeenCalled()
  })
})
