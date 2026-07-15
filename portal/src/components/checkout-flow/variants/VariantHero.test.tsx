/**
 * Tests for VariantHero.tsx
 *
 * Validates:
 * - Config-driven rendering: headline + bullets from `templateConfig` render
 * - Graceful no-throw on empty/undefined `templateConfig` (renders nothing,
 *   not an error state — this is a content-only hero, no products to skip to)
 * - The `hero` template is wired into VARIANT_REGISTRY + CONTENT_ONLY_TEMPLATES
 */

import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import {
  CONTENT_ONLY_TEMPLATES,
  VARIANT_REGISTRY,
} from "../registries/variantRegistry"
import VariantHero from "./VariantHero"

function renderVariant(templateConfig?: Record<string, unknown> | null) {
  return render(
    <VariantHero
      products={[]}
      stepType="hero"
      templateConfig={templateConfig}
    />,
  )
}

describe("VariantHero", () => {
  it("renders headline and bullets from templateConfig", () => {
    renderVariant({
      headline: "4 días de música, arte, yoga y talleres",
      bullets: ["+200 artistas y facilitadores", "+10 escenarios"],
    })

    expect(
      screen.getByText("4 días de música, arte, yoga y talleres"),
    ).toBeTruthy()
    expect(screen.getByText("+200 artistas y facilitadores")).toBeTruthy()
    expect(screen.getByText("+10 escenarios")).toBeTruthy()
  })

  it("renders subtitle and date badge when present", () => {
    renderVariant({
      subtitle: "Una celebración de amor, apertura y conexión",
      date_badge: "Experiencia Extendida — 17, 18 y 19 de noviembre",
    })

    expect(
      screen.getByText("Una celebración de amor, apertura y conexión"),
    ).toBeTruthy()
    expect(
      screen.getByText("Experiencia Extendida — 17, 18 y 19 de noviembre"),
    ).toBeTruthy()
  })

  it("does not throw and renders nothing meaningful with undefined config", () => {
    expect(() => renderVariant(undefined)).not.toThrow()
  })

  it("does not throw with an empty config object", () => {
    const { container } = renderVariant({})
    expect(container).toBeTruthy()
  })

  it("is registered under 'hero' in VARIANT_REGISTRY", () => {
    expect(VARIANT_REGISTRY.hero).toBe(VariantHero)
  })

  it("is marked content-only (non-purchasable)", () => {
    expect(CONTENT_ONLY_TEMPLATES.has("hero")).toBe(true)
  })

  it("renders the bullet ornament from config as a masked span", () => {
    const { container } = renderVariant({
      bullets: ["+10 escenarios"],
      bullet_icon_url: "/checkout-skins/amanita/ornaments/star.svg",
    })

    const bullet = container.querySelector("li > span[aria-hidden]")
    expect(bullet).toBeTruthy()
    const style = (bullet as HTMLElement).style
    expect(style.maskImage).toContain(
      "/checkout-skins/amanita/ornaments/star.svg",
    )
    // Tint comes from the skin, never a hardcoded brand hex.
    expect(style.backgroundColor).toBe("var(--hero-bullet-color, currentColor)")
  })

  it("omits the bullet ornament when no bullet_icon_url is configured", () => {
    const { container } = renderVariant({ bullets: ["+10 escenarios"] })

    expect(container.querySelector("li > span[aria-hidden]")).toBeNull()
    expect(screen.getByText("+10 escenarios")).toBeTruthy()
  })

  it("renders the divider ornament from config alongside the subtitle", () => {
    const { container } = renderVariant({
      subtitle: "Una celebración de amor, apertura y conexión",
      divider_url: "/checkout-skins/amanita/ornaments/divider-1-dark.webp",
    })

    const divider = container.querySelector('img[aria-hidden="true"]')
    expect(divider).toBeTruthy()
    expect((divider as HTMLImageElement).getAttribute("alt")).toBe("")
  })

  it("omits the divider when no divider_url is configured", () => {
    const { container } = renderVariant({
      subtitle: "Una celebración de amor, apertura y conexión",
    })

    expect(container.querySelector('img[aria-hidden="true"]')).toBeNull()
    expect(
      screen.getByText("Una celebración de amor, apertura y conexión"),
    ).toBeTruthy()
  })

  it("does not import from any skin package (generic template)", async () => {
    const filePath = join(
      dirname(fileURLToPath(import.meta.url)),
      "VariantHero.tsx",
    )
    const source = await readFile(filePath, "utf8")
    expect(source).not.toContain("skins/")
  })
})
