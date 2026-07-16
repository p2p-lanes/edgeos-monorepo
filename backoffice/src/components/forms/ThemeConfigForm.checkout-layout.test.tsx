/**
 * Tests for ThemeConfigForm — checkout shell + skin toggles
 *
 * Covers:
 * - saving the form with non-default shell/skin writes
 *   theme_config.checkout_shell / theme_config.checkout_skin
 * - an existing theme_config with checkout_shell/checkout_skin pre-selects
 *   the corresponding toggle buttons
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

// --- Mocks ---

vi.mock("@/client", () => ({
  PopupsService: {
    updatePopup: vi.fn(),
  },
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({
    showSuccessToast: vi.fn(),
    showErrorToast: vi.fn(),
  }),
}))

import { PopupsService } from "@/client"
import { ThemeConfigForm } from "./ThemeConfigForm"

const mockUpdatePopup = vi.mocked(PopupsService.updatePopup)

function makeWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe("ThemeConfigForm checkout layout toggles", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("saves checkout_shell and checkout_skin into theme_config", async () => {
    mockUpdatePopup.mockResolvedValue(
      {} as Awaited<ReturnType<typeof PopupsService.updatePopup>>,
    )

    render(<ThemeConfigForm popupId="popup-1" themeConfig={null} />, {
      wrapper: makeWrapper(),
    })

    fireEvent.click(screen.getByRole("button", { name: /stepper/i }))
    fireEvent.click(screen.getByRole("button", { name: /amanita/i }))
    fireEvent.click(screen.getByRole("button", { name: /save theme/i }))

    await waitFor(() =>
      expect(mockUpdatePopup).toHaveBeenCalledWith({
        popupId: "popup-1",
        requestBody: {
          theme_config: expect.objectContaining({
            checkout_shell: "stepper",
            checkout_skin: "amanita",
          }),
        },
      }),
    )
  })

  it("pre-selects toggles from an existing theme_config", () => {
    render(
      <ThemeConfigForm
        popupId="popup-1"
        themeConfig={{ checkout_shell: "stepper", checkout_skin: "amanita" }}
      />,
      { wrapper: makeWrapper() },
    )

    expect(screen.getByRole("button", { name: /stepper/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
    expect(screen.getByRole("button", { name: /amanita/i })).toHaveAttribute(
      "aria-pressed",
      "true",
    )
  })
})
