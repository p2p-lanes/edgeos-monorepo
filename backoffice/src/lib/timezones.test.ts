import { describe, expect, it } from "vitest"

import { TIMEZONE_COUNTRY } from "./timezone-countries.generated"
import {
  canonicalizeTimezone,
  formatTimezoneLabel,
  getTimezoneOptions,
  normalizeSearch,
  syntheticTimezoneOption,
} from "./timezones"

/** The combobox's own filter: every token has to appear in the haystack. */
function search(query: string): string[] {
  const tokens = normalizeSearch(query).split(/\s+/).filter(Boolean)
  return getTimezoneOptions()
    .filter((tz) => tokens.every((token) => tz.searchText.includes(token)))
    .map((tz) => tz.id)
}

describe("getTimezoneOptions", () => {
  const options = getTimezoneOptions()

  it("covers every generated zone plus UTC", () => {
    expect(options).toHaveLength(Object.keys(TIMEZONE_COUNTRY).length + 1)
    expect(new Set(options.map((tz) => tz.id)).size).toBe(options.length)
  })

  it("gives every zone a country and an offset, UTC aside", () => {
    for (const tz of options) {
      expect(tz.offset, tz.id).not.toBe("")
      if (tz.id !== "UTC") expect(tz.country, tz.id).not.toBeNull()
    }
  })

  it("includes UTC", () => {
    const utc = options.find((tz) => tz.id === "UTC")
    expect(utc).toBeDefined()
    expect(utc?.country).toBeNull()
  })

  it("splits an id into city and region", () => {
    const bue = options.find((tz) => tz.id === "America/Argentina/Buenos_Aires")
    expect(bue).toMatchObject({
      city: "Buenos Aires",
      country: "Argentina",
      region: "America",
    })
  })

  it("lists the modern id, not ICU's historical one", () => {
    const ids = new Set(options.map((tz) => tz.id))
    expect(ids.has("Asia/Kolkata")).toBe(true)
    expect(ids.has("Asia/Calcutta")).toBe(false)
    expect(ids.has("Europe/Kyiv")).toBe(true)
    expect(ids.has("Europe/Kiev")).toBe(false)
  })
})

describe("search", () => {
  it("finds every Spanish zone by country name", () => {
    const hits = search("spain")
    expect(hits).toContain("Europe/Madrid")
    expect(hits).toContain("Africa/Ceuta")
    expect(hits).toContain("Atlantic/Canary")
  })

  it("matches a multi-word city", () => {
    expect(search("buenos aires")).toContain("America/Argentina/Buenos_Aires")
  })

  it("ignores diacritics", () => {
    expect(search("bogota")).toContain("America/Bogota")
    expect(search("cordoba")).toContain("America/Argentina/Cordoba")
  })

  it("matches a GMT offset", () => {
    const hits = search("gmt-3")
    expect(hits.length).toBeGreaterThan(0)
    expect(hits).toContain("America/Argentina/Buenos_Aires")
  })

  it("still finds a zone by its historical id", () => {
    expect(search("calcutta")).toContain("Asia/Kolkata")
    expect(search("kiev")).toContain("Europe/Kyiv")
  })

  it("narrows rather than widens as tokens are added", () => {
    expect(search("madrid spain")).toEqual(["Europe/Madrid"])
  })
})

describe("canonicalizeTimezone", () => {
  it("rewrites a historical id onto the listed one", () => {
    expect(canonicalizeTimezone("Asia/Calcutta")).toBe("Asia/Kolkata")
    expect(canonicalizeTimezone("America/Buenos_Aires")).toBe(
      "America/Argentina/Buenos_Aires",
    )
  })

  it("leaves anything else alone", () => {
    expect(canonicalizeTimezone("Europe/Madrid")).toBe("Europe/Madrid")
    expect(canonicalizeTimezone("Foo/Bar")).toBe("Foo/Bar")
  })
})

describe("syntheticTimezoneOption", () => {
  it("keeps an unknown value selectable", () => {
    const orphan = syntheticTimezoneOption("Foo/Bar")
    expect(orphan).toMatchObject({
      id: "Foo/Bar",
      city: "Bar",
      country: null,
      region: "Foo",
      offset: "",
    })
    expect(getTimezoneOptions().some((tz) => tz.id === "Foo/Bar")).toBe(false)
  })
})

describe("formatTimezoneLabel", () => {
  it("appends the offset when the runtime knows the zone", () => {
    expect(formatTimezoneLabel("UTC")).toBe("UTC (GMT+0)")
    expect(formatTimezoneLabel("Foo/Bar")).toBe("Foo/Bar")
  })
})
