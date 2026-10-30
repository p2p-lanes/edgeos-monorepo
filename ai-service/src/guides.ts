import { readdir, readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

// Backoffice usage guides teach the assistant where things are in the UI and
// how to do them by hand. Unlike workflow skills they describe screens, not
// API operations. navigation.md is the always-on map; every other file is a
// guide retrieved per request.

export type BackofficeGuide = {
  name: string
  description: string
  triggers: string[]
  routes: string[]
  roles: string
  instructions: string
}

export const NAVIGATION_FILE = "navigation.md"

const STOPWORDS = new Set([
  // English
  "a",
  "an",
  "and",
  "are",
  "can",
  "do",
  "does",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "the",
  "there",
  "this",
  "to",
  "what",
  "where",
  "why",
  "with",
  "you",
  // Spanish
  "como",
  "con",
  "de",
  "del",
  "donde",
  "el",
  "en",
  "es",
  "hago",
  "la",
  "las",
  "lo",
  "los",
  "mi",
  "para",
  "por",
  "puedo",
  "que",
  "se",
  "un",
  "una",
  "y",
  // Product names match every guide
  "backoffice",
  "edgeos",
  "portal",
])

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
}

function terms(value: string) {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 1 && !STOPWORDS.has(term))
}

export function parseGuide(source: string): BackofficeGuide | null {
  const match = source.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return null
  const metadata = Object.fromEntries(
    (match[1] ?? "")
      .split("\n")
      .map((line) => line.match(/^([a-z_]+):\s*(.*)$/i))
      .filter((item): item is RegExpMatchArray => item !== null)
      .map((item) => [item[1], item[2]]),
  )
  if (!metadata.name || !metadata.description) return null
  const list = (value?: string) =>
    (value ?? "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
  return {
    name: metadata.name,
    description: metadata.description,
    triggers: list(metadata.triggers).map(normalize),
    routes: list(metadata.routes),
    roles: metadata.roles ?? "operator",
    instructions: (match[2] ?? "").trim(),
  }
}

export function routeMatches(route: string, pathname: string) {
  const pattern = route
    .split("?")[0]
    ?.split("/")
    .map((segment) =>
      segment.startsWith("$")
        ? "[^/]+"
        : segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("/")
  return new RegExp(`^${pattern}/?$`).test(pathname)
}

export class GuideRegistry {
  private guides: BackofficeGuide[] = []
  private navigation = ""

  constructor(
    private readonly root = join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "guides",
    ),
  ) {}

  async load() {
    let files: string[] = []
    try {
      files = (await readdir(this.root)).filter((file) => file.endsWith(".md"))
    } catch {
      console.warn(`EdgeOS guides directory is unavailable: ${this.root}`)
      return
    }
    const loaded = await Promise.all(
      files.map(async (file) => {
        const source = await readFile(join(this.root, file), "utf8").catch(
          () => null,
        )
        if (source === null) return null
        if (file === NAVIGATION_FILE) {
          this.navigation = source.trim()
          return null
        }
        return parseGuide(source)
      }),
    )
    this.guides = loaded.filter(
      (guide): guide is BackofficeGuide => guide !== null,
    )
  }

  all() {
    return [...this.guides]
  }

  get(name: string) {
    return this.guides.find((guide) => guide.name === name.trim())
  }

  navigationMap() {
    return this.navigation || "The backoffice navigation map is unavailable."
  }

  search(query: string, options: { pathname?: string; limit?: number } = {}) {
    const queryTerms = terms(query)
    const querySet = new Set(queryTerms)
    return this.guides
      .map((guide) => {
        let score = 0
        // A multi-word trigger matches when all its words are in the query,
        // so "grant a ticket" still hits "grant ticket".
        for (const trigger of guide.triggers) {
          const triggerTerms = terms(trigger)
          if (
            triggerTerms.length > 1 &&
            triggerTerms.every((term) => querySet.has(term))
          ) {
            score += 8
          }
        }
        const haystack = new Set(
          terms([guide.name, guide.description, ...guide.triggers].join(" ")),
        )
        for (const term of queryTerms) {
          if (haystack.has(term)) score += term.length > 5 ? 3 : 2
        }
        const { pathname } = options
        if (
          score > 0 &&
          pathname &&
          guide.routes.some((route) => routeMatches(route, pathname))
        ) {
          score += 4
        }
        return { guide, score }
      })
      .filter(({ score }) => score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, options.limit ?? 3)
  }

  relevantInstructions(query: string, pathname?: string) {
    const relevant = this.search(query, { pathname, limit: 2 }).filter(
      ({ score }) => score >= 6,
    )
    if (!relevant.length) {
      return "No usage guide matched this request. Call searchBackofficeGuides for how/where questions."
    }
    return relevant.map(({ guide }) => formatGuide(guide)).join("\n\n")
  }
}

export function formatGuide(guide: BackofficeGuide) {
  return `## Guide: ${guide.name}\n${guide.description}\nRoutes: ${guide.routes.join(", ") || "none"} · Minimum role: ${guide.roles}\n\n${guide.instructions}`
}
