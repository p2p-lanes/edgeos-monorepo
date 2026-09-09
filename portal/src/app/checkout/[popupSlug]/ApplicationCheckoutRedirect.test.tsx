import { render } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const replace = vi.fn()

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}))

vi.mock("@/components/ui/Loader", () => ({
  Loader: () => <div data-testid="loader" />,
}))

import { ApplicationCheckoutRedirect } from "./ApplicationCheckoutRedirect"

describe("ApplicationCheckoutRedirect", () => {
  beforeEach(() => replace.mockReset())

  it.each([
    [
      "attendee-flow-id",
      "/portal/spring-fest/passes/buy?flow=attendee-flow-id",
    ],
    [
      "volunteer-flow-id",
      "/portal/spring-fest/passes/buy?flow=volunteer-flow-id",
    ],
  ])("hands authenticated flow %s to the legacy Buy route without dropping it", (flowId, target) => {
    render(
      <ApplicationCheckoutRedirect popupSlug="spring-fest" flowId={flowId} />,
    )

    expect(replace).toHaveBeenCalledWith(target)
  })
})
