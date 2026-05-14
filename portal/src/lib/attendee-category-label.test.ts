import { describe, expect, it, vi } from "vitest"
import type { AttendeeCategoryPublic } from "@/client"
import { resolveCategoryLabel } from "./attendee-category-label"

function makeCategory(
  key: string,
  label?: string | null,
): AttendeeCategoryPublic {
  return {
    id: `cat-${key}`,
    key,
    is_primary: key === "main",
    sort_order: 0,
    enabled_in_passes_flow: true,
    display_meta: label != null ? { label } : {},
    required_fields: [],
    popup_id: "popup-1",
    tenant_id: "tenant-1",
  }
}

describe("resolveCategoryLabel", () => {
  it("uses display_meta.label when set", () => {
    const t = vi.fn((k: string) => k)
    const cat = makeCategory("sponsor", "Sponsor VIP")
    expect(resolveCategoryLabel(cat, t)).toBe("Sponsor VIP")
    expect(t).not.toHaveBeenCalled()
  })

  it("falls back to i18n key when display_meta.label is null", () => {
    const t = vi.fn((k: string) => `translated:${k}`)
    const cat = makeCategory("kid", null)
    const result = resolveCategoryLabel(cat, t)
    expect(t).toHaveBeenCalledWith("companions.add_kid")
    expect(result).toBe("translated:companions.add_kid")
  })

  it("falls back to i18n key when display_meta.label is missing", () => {
    const t = vi.fn((k: string) => `translated:${k}`)
    const cat = makeCategory("spouse")
    const result = resolveCategoryLabel(cat, t)
    expect(t).toHaveBeenCalledWith("companions.add_spouse")
    expect(result).toBe("translated:companions.add_spouse")
  })

  it("falls back to titlecase of key when i18n returns the key itself (unknown category)", () => {
    // When t() returns the same key string, it means no translation found
    const t = vi.fn((k: string) => k)
    const cat = makeCategory("caregiver")
    const result = resolveCategoryLabel(cat, t)
    // t is called, returns key back, so titlecase fallback applies
    expect(result).toBe("Caregiver")
  })

  it("returns titlecase when display_meta is empty and no i18n key found", () => {
    const t = vi.fn((k: string) => k) // returns key = no translation
    const cat = makeCategory("nanny")
    expect(resolveCategoryLabel(cat, t)).toBe("Nanny")
  })
})
