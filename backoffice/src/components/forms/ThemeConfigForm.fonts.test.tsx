/**
 * Tests for ThemeConfigForm — Google Font pickers.
 *
 * Covers the wiring that is easy to get wrong and invisible until an admin
 * loses their work: serialization into `theme_config.typography`, hydration
 * from an existing config, and the dirty check that enables Save.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const CATALOG = {
  source: "google" as const,
  fonts: [
    {
      family: "Inter",
      category: "sans-serif",
      variants: ["regular"],
      subsets: ["latin"],
    },
    {
      family: "Playfair Display",
      category: "serif",
      variants: ["regular"],
      subsets: ["latin"],
    },
  ],
}

vi.mock("@/client", () => ({
  PopupsService: { updatePopup: vi.fn() },
  GoogleFontsService: { listGoogleFonts: vi.fn() },
}))

vi.mock("@/hooks/useCustomToast", () => ({
  default: () => ({ showSuccessToast: vi.fn(), showErrorToast: vi.fn() }),
}))

import { GoogleFontsService, PopupsService } from "@/client"
import { ThemeConfigForm } from "./ThemeConfigForm"

const mockUpdatePopup = vi.mocked(PopupsService.updatePopup)
const mockListFonts = vi.mocked(GoogleFontsService.listGoogleFonts)

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

/** Open the collapsed "Typography & radius" panel. */
function expandTypography() {
  fireEvent.click(screen.getByText(/typography & radius/i))
}

/**
 * `userEvent`, not `fireEvent`: Radix's popover opens on pointerdown, which
 * fireEvent.click never dispatches — the panel would silently stay closed.
 */
async function pickFont(pickerLabel: RegExp, family: string) {
  const user = userEvent.setup()
  await user.click(screen.getByRole("combobox", { name: pickerLabel }))
  await user.click(await screen.findByRole("button", { name: family }))
}

describe("ThemeConfigForm google font pickers", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListFonts.mockResolvedValue(
      CATALOG as Awaited<ReturnType<typeof GoogleFontsService.listGoogleFonts>>,
    )
    mockUpdatePopup.mockResolvedValue(
      {} as Awaited<ReturnType<typeof PopupsService.updatePopup>>,
    )
  })

  it("saves the picked body font under typography.font_family", async () => {
    render(<ThemeConfigForm popupId="popup-1" themeConfig={null} />, {
      wrapper: makeWrapper(),
    })

    expandTypography()
    await pickFont(/body font/i, "Inter")
    fireEvent.click(screen.getByRole("button", { name: /save theme/i }))

    await waitFor(() =>
      expect(mockUpdatePopup).toHaveBeenCalledWith({
        popupId: "popup-1",
        requestBody: {
          theme_config: expect.objectContaining({
            typography: expect.objectContaining({ font_family: "Inter" }),
          }),
        },
      }),
    )
  })

  it("keeps the heading font in its own key", async () => {
    render(<ThemeConfigForm popupId="popup-1" themeConfig={null} />, {
      wrapper: makeWrapper(),
    })

    expandTypography()
    await pickFont(/heading font/i, "Playfair Display")
    fireEvent.click(screen.getByRole("button", { name: /save theme/i }))

    await waitFor(() =>
      expect(mockUpdatePopup).toHaveBeenCalledWith({
        popupId: "popup-1",
        requestBody: {
          theme_config: expect.objectContaining({
            typography: expect.objectContaining({
              font_heading_family: "Playfair Display",
            }),
          }),
        },
      }),
    )
  })

  it("hydrates both pickers from an existing theme_config", () => {
    render(
      <ThemeConfigForm
        popupId="popup-1"
        themeConfig={{
          typography: {
            font_family: "Inter",
            font_heading_family: "Playfair Display",
          },
        }}
      />,
      { wrapper: makeWrapper() },
    )

    expandTypography()

    expect(
      within(screen.getByRole("combobox", { name: /body font/i })).getByText(
        "Inter",
      ),
    ).toBeTruthy()
    expect(
      within(screen.getByRole("combobox", { name: /heading font/i })).getByText(
        "Playfair Display",
      ),
    ).toBeTruthy()
  })

  it("leaves the font keys out when only a non-font typography value is set", async () => {
    // Adding two font keys must not make every save start writing them as
    // empty strings, which the portal would then have to defend against.
    render(<ThemeConfigForm popupId="popup-1" themeConfig={null} />, {
      wrapper: makeWrapper(),
    })

    expandTypography()
    fireEvent.change(screen.getByPlaceholderText("16px"), {
      target: { value: "18px" },
    })
    fireEvent.click(screen.getByRole("button", { name: /save theme/i }))

    await waitFor(() => expect(mockUpdatePopup).toHaveBeenCalled())
    const body = mockUpdatePopup.mock.calls[0][0].requestBody as {
      theme_config: { typography?: Record<string, unknown> } | null
    }
    expect(body.theme_config?.typography).toEqual({ font_base_size: "18px" })
  })

  it("clearing a saved font removes it from the payload", async () => {
    render(
      <ThemeConfigForm
        popupId="popup-1"
        themeConfig={{ typography: { font_family: "Inter" } }}
      />,
      { wrapper: makeWrapper() },
    )

    expandTypography()
    fireEvent.click(screen.getByRole("button", { name: /clear font/i }))
    fireEvent.click(screen.getByRole("button", { name: /save theme/i }))

    await waitFor(() => expect(mockUpdatePopup).toHaveBeenCalled())
    const body = mockUpdatePopup.mock.calls[0][0].requestBody as {
      theme_config: Record<string, unknown> | null
    }
    expect(body.theme_config?.typography).toBeUndefined()
  })
})
