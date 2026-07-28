// Auto-extraction of translatable text leaves from a ticketing step's nested
// `template_config`. The organizer never edits JSON: we walk the config, list
// every user-visible text leaf as a flat field, and on save rebuild a partial
// config mirror holding only the translated leaves. The backend deep-merges
// that partial over the source, preserving ids, prices, flags and icons.

// Object keys whose string value is user-visible copy.
// Kept in sync with the backend extractor (app/api/translation/service.py):
// a key missing here hides the field from the organizer, and a key missing
// there means the AI never drafts it — the two lists must not drift.
const TEXT_LEAF_KEYS = new Set([
  "label",
  "description",
  "title",
  "subtitle",
  "card_title",
  "card_subtitle",
  "toggle_label",
  "footer_text",
  "question",
  "answer",
  "caption",
  "html",
  // Hero copy. `cta_label` is the button a visitor actually clicks and
  // `headline` is the largest text on the page, so leaving them out made a
  // "translated" checkout still open in the source language.
  "headline",
  "edition",
  "date_badge",
  "cta_label",
  "cta_hint",
])

// Keys holding an array of user-visible strings (each item is a leaf).
const TEXT_LIST_KEYS = new Set(["benefits", "bullets"])

const MULTILINE_LEAF_KEYS = new Set([
  "description",
  "subtitle",
  "card_subtitle",
  "answer",
  "html",
])

export interface ConfigLeaf {
  /** Dot/index path into the config, e.g. "sections.0.label". */
  path: string
  /** Human label shown next to the editor. */
  label: string
  /** Source (default-language) text. */
  value: string
  multiline: boolean
}

function humanizeKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
}

/**
 * Walk a template_config and return every translatable text leaf, in a stable
 * document order. Only known text keys are collected; structural and numeric
 * values are ignored so they can never be accidentally translated.
 */
export function extractTranslatableLeaves(
  config: unknown,
  prefix = "",
): ConfigLeaf[] {
  if (!config || typeof config !== "object") return []

  const leaves: ConfigLeaf[] = []
  const entries = Array.isArray(config)
    ? config.map((v, i) => [String(i), v] as const)
    : Object.entries(config as Record<string, unknown>)

  for (const [key, value] of entries) {
    const path = prefix ? `${prefix}.${key}` : key

    if (TEXT_LEAF_KEYS.has(key) && typeof value === "string") {
      if (value.trim()) {
        leaves.push({
          path,
          label: humanizeKey(key),
          value,
          multiline: MULTILINE_LEAF_KEYS.has(key),
        })
      }
      continue
    }

    if (TEXT_LIST_KEYS.has(key) && Array.isArray(value)) {
      value.forEach((item, index) => {
        if (typeof item === "string" && item.trim()) {
          leaves.push({
            path: `${path}.${index}`,
            label: `${humanizeKey(key)} ${index + 1}`,
            value: item,
            multiline: false,
          })
        }
      })
      continue
    }

    if (value && typeof value === "object") {
      leaves.push(...extractTranslatableLeaves(value, path))
    }
  }

  return leaves
}

/** Set a value at a dot/index path, creating objects/arrays as needed. */
function setByPath(
  target: Record<string, unknown>,
  path: string,
  value: string,
): void {
  const segments = path.split(".")
  let cursor: Record<string, unknown> | unknown[] = target

  segments.forEach((segment, i) => {
    const isLast = i === segments.length - 1
    const nextIsIndex = !isLast && /^\d+$/.test(segments[i + 1])
    const key = /^\d+$/.test(segment) ? Number(segment) : segment

    if (isLast) {
      ;(cursor as Record<string | number, unknown>)[key] = value
      return
    }

    const container = cursor as Record<string | number, unknown>
    if (container[key] === undefined) {
      container[key] = nextIsIndex ? [] : {}
    }
    cursor = container[key] as Record<string, unknown> | unknown[]
  })
}

/**
 * Rebuild a partial template_config mirror from path->translation entries.
 * Empty translations are skipped so untranslated leaves fall back to source
 * via the backend deep-merge. Returns null when nothing was translated.
 */
export function buildPartialConfig(
  drafts: Record<string, string>,
): Record<string, unknown> | null {
  const partial: Record<string, unknown> = {}
  let hasAny = false
  for (const [path, value] of Object.entries(drafts)) {
    if (value.trim()) {
      setByPath(partial, path, value)
      hasAny = true
    }
  }
  return hasAny ? partial : null
}

export interface LeafGroup {
  key: string
  label: string
  leaves: ConfigLeaf[]
}

function singularize(word: string): string {
  return word.endsWith("s") ? word.slice(0, -1) : word
}

// Friendly group headers per config key. Array-record keys get the item number
// appended ("FAQ 1"); named-object keys are used as-is. Anything not listed
// falls back to the humanized (and, for records, singularized) key.
const GROUP_ALIASES: Record<string, string> = {
  items: "FAQ",
  sections: "Section",
  menu_options: "Meal option",
  products: "Product",
  insurance: "Insurance",
  chef_choice_option: "Chef's choice",
  benefits: "Benefits",
}

/**
 * Derive the group a leaf belongs to from its path. Array records group under
 * "<Name> <n>" ("items.0.question" -> "FAQ 1"); named objects group under their
 * friendly key ("insurance.card_title" -> "Insurance"); top-level leaves fall
 * under "General".
 */
function deriveGroup(path: string): { key: string; label: string } {
  const parent = path.split(".").slice(0, -1)
  if (parent.length === 0) {
    return { key: "__general", label: "General" }
  }
  const last = parent[parent.length - 1]
  if (/^\d+$/.test(last)) {
    const name = parent[parent.length - 2] ?? "item"
    const alias = GROUP_ALIASES[name] ?? singularize(humanizeKey(name))
    return { key: parent.join("."), label: `${alias} ${Number(last) + 1}` }
  }
  return {
    key: parent.join("."),
    label: GROUP_ALIASES[last] ?? humanizeKey(last),
  }
}

/**
 * Group flat leaves back into their parent records so the editor can render a
 * card per FAQ item, section, insurance block, etc., in document order.
 */
export function groupLeaves(leaves: ConfigLeaf[]): LeafGroup[] {
  const groups = new Map<string, LeafGroup>()
  for (const leaf of leaves) {
    const { key, label } = deriveGroup(leaf.path)
    const existing = groups.get(key)
    if (existing) {
      existing.leaves.push(leaf)
    } else {
      groups.set(key, { key, label, leaves: [leaf] })
    }
  }
  return Array.from(groups.values())
}

/** Flatten a stored partial config back to path->value for editing. */
export function flattenConfigValues(
  config: unknown,
  prefix = "",
): Record<string, string> {
  if (!config || typeof config !== "object") return {}

  const flat: Record<string, string> = {}
  const entries = Array.isArray(config)
    ? config.map((v, i) => [String(i), v] as const)
    : Object.entries(config as Record<string, unknown>)

  for (const [key, value] of entries) {
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === "string") {
      flat[path] = value
    } else if (value && typeof value === "object") {
      Object.assign(flat, flattenConfigValues(value, path))
    }
  }
  return flat
}
