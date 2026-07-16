import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CONTENT_ONLY_TEMPLATES, TEMPLATE_DEFINITIONS } from "../constants"
import { HeroConfig } from "./HeroConfig"
import { TEMPLATE_CONFIG_REGISTRY } from "./index"

vi.mock("@/hooks/useFileUpload", () => ({
  useFileUpload: () => ({
    uploadFile: vi.fn().mockResolvedValue({ publicUrl: "https://cdn/x.webp" }),
    uploadProgress: { status: "idle", progress: 0, error: null },
    reset: vi.fn(),
    isUploading: false,
  }),
}))

describe("HeroConfig registration", () => {
  it("is offered in the template grid", () => {
    expect(TEMPLATE_DEFINITIONS.some((d) => d.key === "hero")).toBe(true)
  })

  it("is content-only (no product category)", () => {
    expect(CONTENT_ONLY_TEMPLATES.has("hero")).toBe(true)
  })

  it("is wired into the config registry", () => {
    expect(TEMPLATE_CONFIG_REGISTRY.hero).toBe(HeroConfig)
  })
})

describe("HeroConfig editor", () => {
  function renderConfig(config: Record<string, unknown> | null = null) {
    const onChange = vi.fn()
    render(
      <HeroConfig
        config={config}
        onChange={onChange}
        popupId="popup-1"
        productCategory={null}
      />,
    )
    return onChange
  }

  it("renders existing copy from config", () => {
    renderConfig({ headline: "4 días de música", cta_label: "Ver Entradas →" })

    expect(screen.getByDisplayValue("4 días de música")).toBeTruthy()
    expect(screen.getByDisplayValue("Ver Entradas →")).toBeTruthy()
  })

  it("persists a headline edit", () => {
    const onChange = renderConfig({ headline: "old" })

    fireEvent.change(screen.getByLabelText("Headline"), {
      target: { value: "new headline" },
    })

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ headline: "new headline" }),
    )
  })

  it("adds a bullet", () => {
    const onChange = renderConfig({ bullets: ["+10 escenarios"] })

    fireEvent.click(screen.getByRole("button", { name: /add bullet/i }))

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ bullets: ["+10 escenarios", ""] }),
    )
  })

  it("removes a bullet", () => {
    const onChange = renderConfig({ bullets: ["a", "b"] })

    fireEvent.click(
      screen.getAllByRole("button", { name: /remove bullet/i })[0],
    )

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ bullets: ["b"] }),
    )
  })

  it("does not throw on a null config", () => {
    expect(() => renderConfig(null)).not.toThrow()
  })
})
