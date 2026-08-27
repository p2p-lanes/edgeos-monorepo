import { createHash } from "node:crypto"
import {
  EdgeOSApiError,
  type EdgeOSContext,
  type PopupSummary,
  responseError,
} from "./context.js"
import { type ExecutionStore, MemoryExecutionStore } from "./execution-store.js"
import type { JsonObject } from "./types.js"

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE"
export type OperationRisk =
  | "read"
  | "standard_write"
  | "destructive"
  | "financial"
  | "security"

export type JsonSchema = {
  $ref?: string
  type?: string | string[]
  title?: string
  description?: string
  format?: string
  enum?: unknown[]
  default?: unknown
  nullable?: boolean
  required?: string[]
  properties?: Record<string, JsonSchema>
  items?: JsonSchema
  allOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  additionalProperties?: boolean | JsonSchema
  [key: string]: unknown
}

type OpenAPIReference = { $ref: string }
type OpenAPIParameter = {
  name?: string
  in?: string
  required?: boolean
  description?: string
  schema?: JsonSchema | OpenAPIReference
}
type OpenAPIRequestBody = {
  required?: boolean
  description?: string
  content?: Record<string, { schema?: JsonSchema | OpenAPIReference }>
}
type OpenAPIResponse = {
  content?: Record<string, { schema?: JsonSchema | OpenAPIReference }>
}
type OpenAPIOperation = {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  parameters?: Array<OpenAPIParameter | OpenAPIReference>
  requestBody?: OpenAPIRequestBody | OpenAPIReference
  responses?: Record<string, OpenAPIResponse | OpenAPIReference>
  deprecated?: boolean
  [key: string]: unknown
}
type OpenAPIPathItem = {
  parameters?: Array<OpenAPIParameter | OpenAPIReference>
  [method: string]: unknown
}
type OpenAPIDocument = {
  paths?: Record<string, OpenAPIPathItem>
  components?: {
    schemas?: Record<string, JsonSchema>
    parameters?: Record<string, OpenAPIParameter>
    requestBodies?: Record<string, OpenAPIRequestBody>
    responses?: Record<string, OpenAPIResponse>
  }
}

export type CatalogParameter = {
  name: string
  location: "path" | "query"
  required: boolean
  description?: string
  schema: JsonSchema
}

export type OperationResult =
  | { kind: "json" }
  | { kind: "download"; mediaTypes: string[]; filename: string }

export type CatalogOperation = {
  operationId: string
  method: HttpMethod
  path: string
  summary: string
  description?: string
  tags: string[]
  parameters: CatalogParameter[]
  requestBody?: {
    required: boolean
    description?: string
    schema: JsonSchema
  }
  result: OperationResult
  risk: OperationRisk
  scope: "organization" | "gathering"
  sideEffects: string[]
}

export type OperationArguments = {
  path?: JsonObject
  query?: JsonObject
  body?: unknown
}

export type OperationPreviewEntity = {
  role: string
  id: string
  primary: string
  secondary?: string
  details: Array<{ label: string; value: string }>
}

export type OperationContext = {
  activeGathering?: { id: string; name: string }
  targetGatherings: Array<{ id: string; name: string }>
  crossContext: boolean
  resolution: "verified" | "organization" | "unknown"
}

export type OperationPreview = {
  operation: {
    operationId: string
    method: HttpMethod
    summary: string
    scope: CatalogOperation["scope"]
    risk: OperationRisk
  }
  context: OperationContext
  title: string
  actionLabel: string
  entities: OperationPreviewEntity[]
  changes: Array<{ label: string; value: string; previousValue?: string }>
  effects: string[]
  warnings: string[]
  technicalDetails: unknown
  fingerprint: string
}

const METHODS: HttpMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE"]
const EXCLUDED_TAGS = new Set([
  "admin-api-keys",
  "ai-executions",
  "api-keys",
  "auth",
  "checkout",
  "custom-exports",
  "portal",
  "publishable-keys",
  "third-party-apps",
  "third-party-discovery",
])
const EXCLUDED_PATH_PARTS = [
  "/webhook",
  "/portal/",
  "/checkout",
  "/login",
  "/my/",
  "/authenticate",
  "/credentials",
  "/api-keys",
  "/publishable-key",
]
const GATHERING_TAGS = new Set([
  "application-reviews",
  "applications",
  "attendee-categories",
  "attendees",
  "check_in",
  "coupons",
  "event-participants",
  "event-settings",
  "event-venues",
  "events",
  "groups",
  "invites",
  "payments",
  "popup-reviewers",
  "popups",
  "products",
  "ticketing-steps",
  "tracks",
])
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CACHE_TTL_MS = 5 * 60_000
const MAX_ARRAY_ITEMS = 100
const MAX_RESPONSE_CHARS = 200_000
const EXECUTION_TTL_MS = 60 * 60_000
const DOWNLOAD_MEDIA_TYPES = new Set([
  "application/octet-stream",
  "application/pdf",
  "text/calendar",
  "text/csv",
])
const REDACTED_KEY =
  /(token|secret|password|credential|api.?key|auth.?code|checkout.?url|meeting.?url|webhook|smtp|private.?key)/i
const URL_KEY = /(^|_)(url|uri)$/i

const SEARCH_ALIASES: Record<string, string[]> = {
  asignar: ["assign", "add", "grant", "ticket"],
  attendee: ["attendee", "participant"],
  asistentes: ["attendees", "participants"],
  actualizar: ["update", "patch", "edit", "change"],
  buscar: ["search", "list", "find", "get"],
  cambiar: ["update", "patch", "edit", "change"],
  change: ["update", "patch", "edit"],
  crear: ["create", "add", "post"],
  archivo: ["file", "download", "export"],
  calendario: ["calendar", "ics"],
  date: ["start_date", "end_date"],
  descargar: ["download", "export"],
  descarga: ["download", "export"],
  dates: ["start_date", "end_date"],
  eliminar: ["delete", "remove"],
  entrada: ["ticket", "pass"],
  entradas: ["tickets", "passes"],
  evento: ["event"],
  fecha: ["start_date", "end_date"],
  fechas: ["start_date", "end_date"],
  factura: ["invoice"],
  facturas: ["invoices"],
  festival: ["popup", "gathering"],
  festivals: ["popups", "gatherings"],
  gathering: ["popup"],
  gatherings: ["popups"],
  pago: ["payment"],
  pagos: ["payments"],
  producto: ["product"],
  productos: ["products"],
  application: ["application"],
  solicitud: ["application", "review"],
  solicitudes: ["applications", "reviews"],
}
const SEARCH_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "de",
  "del",
  "el",
  "for",
  "la",
  "las",
  "los",
  "of",
  "on",
  "para",
  "por",
  "the",
  "this",
  "to",
  "un",
  "una",
  "y",
])

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
}

function tokens(value: string) {
  return normalize(value)
    .split(/[^a-z0-9_:-]+/)
    .filter((token) => token.length > 1 && !SEARCH_STOP_WORDS.has(token))
}

function isReference(value: unknown): value is OpenAPIReference {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as OpenAPIReference).$ref === "string"
  )
}

function clone<T>(value: T): T {
  return structuredClone(value)
}

function resolveLocalReference<T>(
  document: OpenAPIDocument,
  value: T | OpenAPIReference | undefined,
): T | undefined {
  if (!value || !isReference(value)) return value as T | undefined
  const parts = value.$ref.replace(/^#\//, "").split("/")
  let current: unknown = document
  for (const rawPart of parts) {
    const part = rawPart.replace(/~1/g, "/").replace(/~0/g, "~")
    if (typeof current !== "object" || current === null) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current as T | undefined
}

function resolveSchema(
  document: OpenAPIDocument,
  source: JsonSchema | OpenAPIReference | undefined,
  depth = 0,
  seen = new Set<string>(),
): JsonSchema {
  if (!source || depth > 8) return {}
  if (isReference(source)) {
    if (seen.has(source.$ref)) return { $ref: source.$ref }
    const resolved = resolveLocalReference<JsonSchema>(document, source)
    if (!resolved) return { $ref: source.$ref }
    const nextSeen = new Set(seen)
    nextSeen.add(source.$ref)
    return resolveSchema(document, resolved, depth + 1, nextSeen)
  }

  const schema = clone(source)
  if (schema.properties) {
    schema.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, child]) => [
        key,
        resolveSchema(document, child, depth + 1, new Set(seen)),
      ]),
    )
  }
  if (schema.items) {
    schema.items = resolveSchema(
      document,
      schema.items,
      depth + 1,
      new Set(seen),
    )
  }
  for (const union of ["allOf", "anyOf", "oneOf"] as const) {
    if (schema[union]) {
      schema[union] = schema[union]?.map((child) =>
        resolveSchema(document, child, depth + 1, new Set(seen)),
      )
    }
  }
  return schema
}

function baseMediaType(value: string) {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? ""
}

function isJsonMediaType(value: string) {
  const mediaType = baseMediaType(value)
  return mediaType === "application/json" || mediaType.endsWith("+json")
}

function downloadExtension(mediaType: string) {
  const extensions: Record<string, string> = {
    "application/octet-stream": "bin",
    "application/pdf": "pdf",
    "text/calendar": "ics",
    "text/csv": "csv",
  }
  return extensions[baseMediaType(mediaType)] ?? "bin"
}

function downloadFilename(
  operation: Pick<CatalogOperation, "operationId" | "path" | "summary">,
  mediaTypes: string[],
) {
  const extension = downloadExtension(mediaTypes[0] ?? "")
  const explicitName = operation.path.match(/\/([^/]+\.(?:csv|ics|pdf))$/i)?.[1]
  if (explicitName) return explicitName
  if (operation.path.endsWith("/invoice")) return `invoice.${extension}`
  if (operation.path.endsWith("/ics")) return `event.${extension}`
  if (operation.path.endsWith("/csv")) return `export.${extension}`
  const stem = normalize(operation.summary)
    .replace(/\b(export|download|get|as|file)\b/g, " ")
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return `${stem || operation.operationId}.${extension}`
}

function operationResult(
  document: OpenAPIDocument,
  operation: OpenAPIOperation,
  method: HttpMethod,
): OperationResult | undefined {
  const mediaTypes = new Set<string>()
  let hasEmptySuccess = false
  for (const [status, raw] of Object.entries(operation.responses ?? {})) {
    if (!/^2\d\d$/.test(status)) continue
    if (status === "204") hasEmptySuccess = true
    const response = resolveLocalReference<OpenAPIResponse>(document, raw)
    for (const mediaType of Object.keys(response?.content ?? {})) {
      mediaTypes.add(baseMediaType(mediaType))
    }
  }
  if (hasEmptySuccess || [...mediaTypes].some(isJsonMediaType)) {
    return { kind: "json" }
  }
  const downloads = [...mediaTypes].filter((mediaType) =>
    DOWNLOAD_MEDIA_TYPES.has(mediaType),
  )
  if (method === "GET" && downloads.length) {
    return {
      kind: "download",
      mediaTypes: downloads.sort(),
      filename: "",
    }
  }
  return undefined
}

function classifyRisk(
  method: HttpMethod,
  path: string,
  tags: string[],
): OperationRisk {
  if (method === "GET") return "read"
  const text = normalize(`${path} ${tags.join(" ")}`)
  if (/payment|refund|credit|invoice|coupon/.test(text)) return "financial"
  if (/credential|smtp|tenant|user|reviewer|permission|role/.test(text)) {
    return "security"
  }
  if (method === "DELETE" || /delete|remove|revoke|cancel/.test(text)) {
    return "destructive"
  }
  return "standard_write"
}

function sideEffectsFor(
  operation: Pick<CatalogOperation, "method" | "summary" | "risk">,
) {
  if (operation.method === "GET") return []
  const effects = [`Executes ${operation.summary}`]
  if (operation.method === "DELETE") effects.push("May permanently remove data")
  if (operation.risk === "financial")
    effects.push("May affect financial records")
  if (operation.risk === "security")
    effects.push("May affect access or configuration")
  return effects
}

function schemaPropertyNames(schema: JsonSchema, depth = 0): string[] {
  if (depth > 5) return []
  return [
    ...Object.entries(schema.properties ?? {}).flatMap(([name, child]) => [
      name,
      ...schemaPropertyNames(child, depth + 1),
    ]),
    ...(schema.items ? schemaPropertyNames(schema.items, depth + 1) : []),
    ...(["allOf", "anyOf", "oneOf"] as const).flatMap((union) =>
      (schema[union] ?? []).flatMap((child) =>
        schemaPropertyNames(child, depth + 1),
      ),
    ),
  ]
}

function schemaHasProperty(schema: JsonSchema, property: string): boolean {
  if (schema.properties?.[property]) return true
  return (["allOf", "anyOf", "oneOf"] as const).some((union) =>
    (schema[union] ?? []).some((child) => schemaHasProperty(child, property)),
  )
}

function publicSchema(schema: JsonSchema): JsonSchema {
  const copy = clone(schema)
  const visit = (current: JsonSchema, depth: number) => {
    if (depth > 6) return
    delete current.example
    delete current.examples
    if (current.properties) {
      for (const child of Object.values(current.properties))
        visit(child, depth + 1)
    }
    if (current.items) visit(current.items, depth + 1)
    for (const key of ["allOf", "anyOf", "oneOf"] as const) {
      for (const child of current[key] ?? []) visit(child, depth + 1)
    }
  }
  visit(copy, 0)
  return copy
}

export function sanitize(value: unknown, key?: string): unknown {
  if (key && (REDACTED_KEY.test(key) || URL_KEY.test(key))) return "[redacted]"
  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitize(item))
  }
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        sanitize(childValue, childKey),
      ]),
    )
  }
  return value
}

function humanizeField(value: string) {
  return value
    .replace(/_id$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function previewActionLabel(summary: string) {
  const words = summary.trim().split(/\s+/)
  if (!words.length) return "Confirm change"
  const boundary = words.findIndex(
    (word, index) => index > 0 && /^(to|for|from|in|on|with)$/i.test(word),
  )
  const action = words
    .slice(0, boundary > 0 ? boundary : undefined)
    .filter((word, index) => index === 0 || !/^(a|an|the)$/i.test(word))
    .join(" ")
  return action.charAt(0).toUpperCase() + action.slice(1).toLowerCase()
}

function scalarPreviewValue(value: unknown, key?: string) {
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (typeof value === "number") return String(value)
  if (typeof value !== "string") return undefined
  if (key === "decision") {
    const decisions: Record<string, string> = {
      strong_yes: "Strong yes (strongly positive)",
      yes: "Yes (positive)",
      no: "No (negative)",
      strong_no: "Strong no (strongly negative)",
    }
    return decisions[value] ?? value
  }
  if (/status|category|type/i.test(key ?? "") && /^[a-z0-9_-]+$/i.test(value)) {
    return value
      .replace(/[_-]+/g, " ")
      .replace(/^\w/, (letter) => letter.toUpperCase())
  }
  return value
}

function previewChanges(value: unknown, entities: OperationPreviewEntity[]) {
  const changes: Array<{
    label: string
    value: string
    previousValue?: string
  }> = []
  const visit = (current: unknown, key: string | undefined, depth: number) => {
    if (depth > 5 || current === null || current === undefined) return
    if (Array.isArray(current)) {
      for (const item of current.slice(0, MAX_ARRAY_ITEMS))
        visit(item, key, depth + 1)
      return
    }
    if (typeof current === "object") {
      for (const [childKey, child] of Object.entries(current))
        visit(child, childKey, depth + 1)
      return
    }
    if (!key || /(^id$|_id$|tenant|popup)/i.test(key)) return
    const display = scalarPreviewValue(current, key)
    if (display !== undefined) {
      const label = key === "decision" ? "Review decision" : humanizeField(key)
      const previousValue = entities
        .flatMap((entity) => entity.details)
        .find((detail) => detail.label === label)?.value
      changes.push({ label, value: display, previousValue })
    }
  }
  visit(value, undefined, 0)
  return changes.slice(0, 20)
}

function reviewDecisionPhrase(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined
  }
  const decision = (value as JsonObject).decision
  if (decision === "strong_yes") return "strong positive"
  if (decision === "yes") return "positive"
  if (decision === "no") return "negative"
  if (decision === "strong_no") return "strong negative"
  return undefined
}

function previewPresentation(
  operation: CatalogOperation,
  entities: OperationPreviewEntity[],
  body: unknown,
) {
  const target = entities[0]?.primary
  const decision = reviewDecisionPhrase(body)
  if (operation.operationId.endsWith("submit_review") && decision) {
    return {
      title: `Submit a ${decision} review${target ? ` for ${target}` : ""}`,
      actionLabel: `Submit ${decision} review${target ? ` for ${target}` : ""}`,
    }
  }

  const action = previewActionLabel(operation.summary)
  if (!target) return { title: operation.summary, actionLabel: action }
  const preposition = operation.summary.match(/\b(to|for|from|on)\b/i)?.[1]
  const destructive = /^(delete|remove|revoke|cancel)\b/i.test(action)
  return {
    title: operation.summary,
    actionLabel: destructive
      ? `${action.split(/\s+/)[0]} ${target}`
      : `${action} ${preposition?.toLowerCase() ?? "for"} ${target}`,
  }
}

function previewEffects(operation: CatalogOperation) {
  const source = normalize(
    `${operation.summary} ${operation.description ?? ""}`,
  )
  if (operation.operationId.endsWith("submit_review")) {
    return [
      "Your review will be recorded for this application",
      "The application status will be recalculated using this gathering's approval strategy",
    ]
  }

  const effects: string[] = []
  if (/no payment|payment_id null|without payment/.test(source)) {
    effects.push("No payment will be created or changed")
  }
  if (
    /(stock.{0,30}(decrement|reduc)|(decrement|reduc).{0,30}stock)/.test(source)
  ) {
    effects.push("Product stock will be reduced")
  } else if (
    /(stock.{0,30}(increment|restor)|(increment|restor).{0,30}stock)/.test(
      source,
    )
  ) {
    effects.push("Product stock will be restored")
  }
  if (/check.?in code/.test(source)) {
    effects.push("A check-in code will be created or updated")
  }
  if (operation.method === "DELETE") effects.push("The record will be removed")
  if (!effects.length)
    effects.push(`EdgeOS will ${operation.summary.toLowerCase()}`)
  return effects
}

function previewWarnings(operation: CatalogOperation) {
  if (operation.risk === "financial")
    return ["This action may affect financial records"]
  if (operation.risk === "security")
    return ["This action may affect access or configuration"]
  if (operation.risk === "destructive")
    return ["This action may be difficult or impossible to undo"]
  return []
}

function entityFromRecord(
  parameterName: string,
  id: string,
  value: unknown,
): OperationPreviewEntity {
  const record =
    typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as JsonObject)
      : {}
  const nestedRecords = [record.human, record.user, record.attendee].filter(
    (candidate): candidate is JsonObject =>
      typeof candidate === "object" &&
      candidate !== null &&
      !Array.isArray(candidate),
  )
  const identityRecords = [record, ...nestedRecords]
  const fullName = (candidate: JsonObject) => {
    const parts = [candidate.first_name, candidate.last_name].filter(
      (part): part is string => typeof part === "string" && Boolean(part),
    )
    return parts.length ? parts.join(" ") : undefined
  }
  const namedKeys = ["name", "full_name", "title"]
  let primary: string | undefined
  let primaryRecord: JsonObject | undefined
  let primaryKey: string | undefined
  for (const candidate of identityRecords) {
    const directKey = namedKeys.find(
      (key) => typeof candidate[key] === "string" && candidate[key],
    )
    const candidateName = directKey
      ? String(candidate[directKey])
      : fullName(candidate)
    if (candidateName) {
      primary = candidateName
      primaryRecord = candidate
      primaryKey = directKey
      break
    }
  }
  if (!primary) {
    for (const candidate of identityRecords) {
      const fallbackKey = ["email", "slug", "code"].find(
        (key) => typeof candidate[key] === "string" && candidate[key],
      )
      if (fallbackKey) {
        primary = String(candidate[fallbackKey])
        primaryRecord = candidate
        primaryKey = fallbackKey
        break
      }
    }
  }
  const secondaryKeys = ["email", "slug", "category"]
  const secondary = secondaryKeys
    .flatMap((key) =>
      identityRecords.map((candidate) => ({
        candidate,
        key,
        value: candidate[key],
      })),
    )
    .find(
      ({ candidate, key, value: candidateValue }) =>
        !(candidate === primaryRecord && key === primaryKey) &&
        typeof candidateValue === "string" &&
        candidateValue,
    )?.value
  const details: Array<{ label: string; value: string }> = []
  for (const key of ["status", "price", "total_stock_remaining", "is_active"]) {
    if (!(key in record)) continue
    let display = scalarPreviewValue(record[key], key)
    if (
      key === "total_stock_remaining" &&
      record[key] === null &&
      record.total_stock_cap === null
    ) {
      display = "Unlimited"
    }
    if (key === "is_active" && typeof record[key] === "boolean") {
      display = record[key] ? "Active" : "Inactive"
    }
    if (display !== undefined) {
      const label =
        key === "total_stock_remaining"
          ? "Stock"
          : key === "is_active"
            ? "Active"
            : humanizeField(key)
      details.push({ label, value: display })
    }
  }
  return {
    role: humanizeField(parameterName),
    id,
    primary: primary ?? humanizeField(parameterName),
    secondary: typeof secondary === "string" ? secondary : undefined,
    details,
  }
}

function collectUuidReferences(args: OperationArguments) {
  const references = new Map<string, { parameterName: string; value: string }>()
  const visit = (value: unknown, key: string | undefined, depth: number) => {
    if (depth > 4 || value === null || value === undefined) return
    if (
      key?.endsWith("_id") &&
      key !== "popup_id" &&
      key !== "tenant_id" &&
      typeof value === "string" &&
      UUID_PATTERN.test(value)
    ) {
      references.set(`${key}:${value}`, { parameterName: key, value })
    }
    if (Array.isArray(value)) {
      for (const item of value.slice(0, MAX_ARRAY_ITEMS))
        visit(item, key, depth + 1)
    } else if (typeof value === "object") {
      for (const [childKey, child] of Object.entries(value))
        visit(child, childKey, depth + 1)
    }
  }
  visit(args, undefined, 0)
  return [...references.values()]
}

function collectPopupIds(value: unknown) {
  const popupIds = new Set<string>()
  const visit = (item: unknown, depth: number) => {
    if (depth > 6 || typeof item !== "object" || item === null) return
    if (Array.isArray(item)) {
      for (const child of item.slice(0, MAX_ARRAY_ITEMS))
        visit(child, depth + 1)
      return
    }
    const record = item as JsonObject
    if (typeof record.popup_id === "string" && record.popup_id) {
      popupIds.add(record.popup_id)
    }
    for (const child of Object.values(record)) visit(child, depth + 1)
  }
  visit(value, 0)
  return popupIds
}

export class EdgeOSOperationCatalog {
  private operations = new Map<string, CatalogOperation>()
  private loadedAt = 0
  private loading?: Promise<void>
  private executions = new Map<
    string,
    { fingerprint: string; promise: Promise<unknown>; expiresAt: number }
  >()
  private popupSummaries = new Map<
    string,
    { popup: PopupSummary; expiresAt: number }
  >()

  constructor(
    private readonly backendUrl: string,
    private readonly executionStore: ExecutionStore = new MemoryExecutionStore(),
  ) {}

  private async ensureLoaded() {
    if (Date.now() - this.loadedAt < CACHE_TTL_MS && this.operations.size)
      return
    if (this.loading) return this.loading
    this.loading = this.load().finally(() => {
      this.loading = undefined
    })
    return this.loading
  }

  private async load() {
    const response = await fetch(`${this.backendUrl}/openapi.json`)
    if (!response.ok) {
      throw new EdgeOSApiError("EdgeOS operation catalog is unavailable", 502)
    }
    const document = (await response.json()) as OpenAPIDocument
    const operations = new Map<string, CatalogOperation>()

    for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
      for (const method of METHODS) {
        const rawOperation = pathItem[method.toLowerCase()]
        if (typeof rawOperation !== "object" || rawOperation === null) continue
        const operation = rawOperation as OpenAPIOperation
        if (!operation.operationId || !this.isAllowed(path, operation, method))
          continue
        const result = operationResult(document, operation, method)
        if (!result) continue

        const rawBody = resolveLocalReference<OpenAPIRequestBody>(
          document,
          operation.requestBody,
        )
        const jsonBody = rawBody?.content?.["application/json"]
        if (rawBody && !jsonBody) continue

        const parameters = [
          ...(pathItem.parameters ?? []),
          ...(operation.parameters ?? []),
        ].flatMap((rawParameter) => {
          const parameter = resolveLocalReference<OpenAPIParameter>(
            document,
            rawParameter,
          )
          if (
            !parameter?.name ||
            (parameter.in !== "path" && parameter.in !== "query")
          ) {
            return []
          }
          return [
            {
              name: parameter.name,
              location: parameter.in,
              required: parameter.required === true,
              description: parameter.description,
              schema: resolveSchema(document, parameter.schema),
            } satisfies CatalogParameter,
          ]
        })

        const tags = operation.tags ?? []
        const risk = classifyRisk(method, path, tags)
        const scope =
          tags.some((tag) => GATHERING_TAGS.has(tag)) ||
          path.includes("{popup_id}") ||
          parameters.some((parameter) => parameter.name === "popup_id") ||
          Boolean(
            jsonBody &&
              schemaHasProperty(
                resolveSchema(document, jsonBody.schema),
                "popup_id",
              ),
          )
            ? "gathering"
            : "organization"
        const catalogOperation: CatalogOperation = {
          operationId: operation.operationId,
          method,
          path,
          summary: operation.summary ?? operation.operationId,
          description: operation.description,
          tags,
          parameters,
          requestBody: jsonBody
            ? {
                required: rawBody?.required === true,
                description: rawBody?.description,
                schema: resolveSchema(document, jsonBody.schema),
              }
            : undefined,
          result,
          risk,
          scope,
          sideEffects: [],
        }
        if (catalogOperation.result.kind === "download") {
          catalogOperation.result.filename = downloadFilename(
            catalogOperation,
            catalogOperation.result.mediaTypes,
          )
        }
        catalogOperation.sideEffects = sideEffectsFor(catalogOperation)
        operations.set(catalogOperation.operationId, catalogOperation)
      }
    }

    this.operations = operations
    this.loadedAt = Date.now()
  }

  private isAllowed(
    path: string,
    operation: OpenAPIOperation,
    method: HttpMethod,
  ) {
    if (!path.startsWith("/api/v1/") || operation.deprecated) return false
    if (path.endsWith("/my")) return false
    if (EXCLUDED_PATH_PARTS.some((part) => path.includes(part))) return false
    if ((operation.tags ?? []).some((tag) => EXCLUDED_TAGS.has(tag)))
      return false
    if (method === "GET" && path.endsWith("/openapi.json")) return false
    return true
  }

  async search(query: string, limit = 8, mode?: "read" | "write") {
    await this.ensureLoaded()
    const normalizedQuery = normalize(query.trim())
    const queryTokens = tokens(query).flatMap((token) => [
      token,
      ...(SEARCH_ALIASES[token] ?? []),
    ])

    return [...this.operations.values()]
      .filter((operation) =>
        mode === "read"
          ? operation.method === "GET"
          : mode === "write"
            ? operation.method !== "GET"
            : true,
      )
      .map((operation) => {
        const haystack = normalize(
          [
            operation.operationId,
            operation.method,
            operation.path,
            operation.summary,
            operation.description,
            operation.scope,
            ...operation.tags,
            ...operation.parameters.map((parameter) => parameter.name),
            ...schemaPropertyNames(operation.requestBody?.schema ?? {}),
          ]
            .filter(Boolean)
            .join(" "),
        )
        let score =
          normalizedQuery && haystack.includes(normalizedQuery) ? 20 : 0
        for (const token of new Set(queryTokens)) {
          if (haystack.includes(token)) score += token.length > 5 ? 4 : 2
          if (normalize(operation.operationId).includes(token)) score += 3
          if (normalize(operation.summary).includes(token)) score += 3
        }
        return { operation, score }
      })
      .filter(({ score }) => !normalizedQuery || score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.operation.operationId.localeCompare(right.operation.operationId),
      )
      .slice(0, Math.min(Math.max(limit, 1), 15))
      .map(({ operation }) => this.describePublic(operation, false))
  }

  async get(operationId: string) {
    await this.ensureLoaded()
    const operation = this.operations.get(operationId)
    if (!operation) {
      throw new EdgeOSApiError(
        "The requested API operation is not available to the assistant",
        404,
      )
    }
    return operation
  }

  async describe(operationId: string) {
    return this.describePublic(await this.get(operationId), true)
  }

  isWrite(operationId: string) {
    const operation = this.operations.get(operationId)
    return operation ? operation.method !== "GET" : undefined
  }

  private describePublic(operation: CatalogOperation, detailed: boolean) {
    const pathParameters = Object.fromEntries(
      operation.parameters
        .filter((parameter) => parameter.location === "path")
        .map((parameter) => [
          parameter.name,
          {
            required: parameter.required,
            description: parameter.description,
            schema: publicSchema(parameter.schema),
          },
        ]),
    )
    const queryParameters = Object.fromEntries(
      operation.parameters
        .filter((parameter) => parameter.location === "query")
        .map((parameter) => [
          parameter.name,
          {
            required: parameter.required,
            description: parameter.description,
            schema: publicSchema(parameter.schema),
          },
        ]),
    )
    return {
      operationId: operation.operationId,
      method: operation.method,
      summary: operation.summary,
      description: detailed
        ? operation.description
        : operation.description?.slice(0, 500),
      resource: operation.tags[0] ?? "edgeos",
      scope: operation.scope,
      risk: operation.risk,
      approval: operation.method === "GET" ? "automatic" : "required",
      sideEffects: operation.sideEffects,
      result: operation.result,
      arguments: detailed
        ? {
            ...(Object.keys(pathParameters).length
              ? { path: pathParameters }
              : {}),
            ...(Object.keys(queryParameters).length
              ? { query: queryParameters }
              : {}),
            ...(operation.requestBody
              ? {
                  body: {
                    required: operation.requestBody.required,
                    description: operation.requestBody.description,
                    schema: publicSchema(operation.requestBody.schema),
                  },
                }
              : {}),
          }
        : {
            path: Object.keys(pathParameters),
            query: Object.keys(queryParameters),
            ...(operation.requestBody
              ? {
                  body: {
                    required: operation.requestBody.required,
                    fields: schemaPropertyNames(
                      operation.requestBody.schema,
                    ).slice(0, 80),
                  },
                }
              : {}),
          },
    }
  }

  async preview(
    operationId: string,
    context: EdgeOSContext,
    args: OperationArguments,
    abortSignal?: AbortSignal,
  ): Promise<OperationPreview> {
    const operation = await this.get(operationId)
    if (operation.method === "GET") {
      throw new EdgeOSApiError("Reads do not require an approval preview", 400)
    }
    const prepared = this.prepareArguments(operation, context, args)
    const effectiveArguments: OperationArguments = {
      path: prepared.pathArgs,
      query: prepared.queryArgs,
      body: prepared.body,
    }
    const references = await this.readReferencedRecords(
      context,
      effectiveArguments,
      abortSignal,
    )
    const operationContext = await this.resolveOperationContext(
      operation,
      context,
      effectiveArguments,
      references.popupIds,
      abortSignal,
    )
    this.assertWriteContextResolved(operation, operationContext)
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          operationId,
          args: effectiveArguments,
          targetPopupIds: operationContext.targetGatherings.map(
            (gathering) => gathering.id,
          ),
        }),
      )
      .digest("hex")

    const presentation = previewPresentation(
      operation,
      references.entities,
      prepared.body,
    )
    const warnings = previewWarnings(operation)
    if (operationContext.crossContext) {
      const targets = operationContext.targetGatherings
        .map((gathering) => gathering.name)
        .join(", ")
      warnings.unshift(
        `This action affects ${targets}, outside the active gathering ${operationContext.activeGathering?.name ?? "context"}`,
      )
    }
    return {
      operation: {
        operationId: operation.operationId,
        method: operation.method,
        summary: operation.summary,
        scope: operation.scope,
        risk: operation.risk,
      },
      context: operationContext,
      title: presentation.title,
      actionLabel: operationContext.crossContext
        ? `${presentation.actionLabel} in ${operationContext.targetGatherings.map((gathering) => gathering.name).join(", ")}`
        : presentation.actionLabel,
      entities: references.entities,
      changes: previewChanges(prepared.body, references.entities),
      effects: previewEffects(operation),
      warnings,
      technicalDetails: sanitize(effectiveArguments),
      fingerprint: fingerprint.slice(0, 12),
    }
  }

  async execute(
    operationId: string,
    context: EdgeOSContext,
    args: OperationArguments,
    options: { toolCallId?: string; abortSignal?: AbortSignal } = {},
  ) {
    const operation = await this.get(operationId)
    if (operation.result.kind === "download") {
      return this.prepareDownload(operation, context, args, options.abortSignal)
    }
    if (operation.method !== "GET" && !options.toolCallId) {
      throw new EdgeOSApiError(
        "Approved writes require a durable tool-call identity",
        400,
      )
    }
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          operationId,
          args,
          userId: context.user.id,
          tenantId: context.tenantId,
          activePopupId: context.popup?.id,
        }),
      )
      .digest("hex")
    const executionKey =
      operation.method !== "GET" && options.toolCallId
        ? `${context.user.id}:${context.tenantId}:${context.popup?.id ?? "organization"}:${options.toolCallId}`
        : undefined

    this.pruneExecutions()
    if (executionKey) {
      const existing = this.executions.get(executionKey)
      if (existing) {
        if (existing.fingerprint !== fingerprint) {
          throw new EdgeOSApiError(
            "The approved operation payload cannot be changed",
            409,
          )
        }
        return existing.promise
      }
    }

    const execution = executionKey
      ? this.executeDurably(
          operation,
          context,
          args,
          options.toolCallId as string,
          fingerprint,
          options,
        )
      : this.executeOnce(operation, context, args, options)
    if (executionKey) {
      this.executions.set(executionKey, {
        fingerprint,
        promise: execution,
        expiresAt: Date.now() + EXECUTION_TTL_MS,
      })
    }
    return execution
  }

  private async executeDurably(
    operation: CatalogOperation,
    context: EdgeOSContext,
    args: OperationArguments,
    toolCallId: string,
    fingerprint: string,
    options: { toolCallId?: string; abortSignal?: AbortSignal },
  ) {
    const claim = await this.executionStore.claim(
      context,
      toolCallId,
      fingerprint,
      options.abortSignal,
    )
    if (claim.state === "completed") return claim.result
    if (claim.state === "pending") {
      throw new EdgeOSApiError(
        "This approved operation is already running or its outcome is unclear. Verify the current state before proposing another write.",
        409,
      )
    }

    const result = await this.executeOnce(operation, context, args, options)
    // Do not inherit the browser abort signal after the domain write succeeds:
    // recording completion is what makes retries safe across restarts/replicas.
    await this.executionStore.complete(context, toolCallId, fingerprint, result)
    return result
  }

  async download(
    operationId: string,
    context: EdgeOSContext,
    args: OperationArguments,
    abortSignal?: AbortSignal,
  ) {
    const operation = await this.get(operationId)
    if (operation.method !== "GET" || operation.result.kind !== "download") {
      throw new EdgeOSApiError(
        "The requested operation is not a downloadable file",
        400,
      )
    }
    const { pathArgs, queryArgs } = this.prepareArguments(
      operation,
      context,
      args,
    )
    const response = await fetch(
      this.operationUrl(operation, pathArgs, queryArgs),
      {
        headers: {
          Authorization: context.authorization,
          "X-Tenant-Id": context.tenantId,
          ...(context.popup ? { "X-Popup-Id": context.popup.id } : {}),
          Accept: operation.result.mediaTypes.join(", "),
        },
        signal: abortSignal,
      },
    )
    if (!response.ok) throw await responseError(response)

    const mediaType = baseMediaType(response.headers.get("Content-Type") ?? "")
    if (!operation.result.mediaTypes.includes(mediaType)) {
      await response.body?.cancel().catch(() => undefined)
      throw new EdgeOSApiError("EdgeOS returned an unexpected file type", 502)
    }

    console.info(
      JSON.stringify({
        event: "edgeos.ai.download",
        userId: context.user.id,
        tenantId: context.tenantId,
        popupId: context.popup?.id,
        operationId: operation.operationId,
        status: response.status,
        requestId: response.headers.get("X-Request-Id") ?? undefined,
        mediaType,
      }),
    )
    return response
  }

  private async prepareDownload(
    operation: CatalogOperation,
    context: EdgeOSContext,
    args: OperationArguments,
    abortSignal?: AbortSignal,
  ) {
    if (operation.result.kind !== "download") {
      throw new EdgeOSApiError("This operation does not return a file", 400)
    }
    const prepared = this.prepareArguments(operation, context, args)
    const effectiveArguments: OperationArguments = {
      path: prepared.pathArgs,
      query: prepared.queryArgs,
    }
    const references = await this.readReferencedRecords(
      context,
      effectiveArguments,
      abortSignal,
    )
    const operationContext = await this.resolveOperationContext(
      operation,
      context,
      effectiveArguments,
      references.popupIds,
      abortSignal,
    )
    return {
      operation: {
        operationId: operation.operationId,
        method: operation.method,
        summary: operation.summary,
        scope: operation.scope,
        risk: operation.risk,
      },
      status: 200,
      context: operationContext,
      arguments: sanitize(effectiveArguments),
      data: null,
      download: {
        endpoint: "/api/ai/downloads",
        filename: operation.result.filename,
        mediaTypes: operation.result.mediaTypes,
        arguments: sanitize(effectiveArguments),
      },
    }
  }

  private pruneExecutions() {
    const now = Date.now()
    for (const [key, execution] of this.executions) {
      if (execution.expiresAt <= now) this.executions.delete(key)
    }
  }

  private prepareArguments(
    operation: CatalogOperation,
    context: EdgeOSContext,
    args: OperationArguments,
  ) {
    const pathArgs = { ...(args.path ?? {}) }
    const queryArgs = { ...(args.query ?? {}) }
    const knownPath = new Set(
      operation.parameters
        .filter((parameter) => parameter.location === "path")
        .map((parameter) => parameter.name),
    )
    const knownQuery = new Set(
      operation.parameters
        .filter((parameter) => parameter.location === "query")
        .map((parameter) => parameter.name),
    )
    const unknownPath = Object.keys(pathArgs).filter(
      (name) => !knownPath.has(name),
    )
    const unknownQuery = Object.keys(queryArgs).filter(
      (name) => !knownQuery.has(name),
    )
    if (unknownPath.length || unknownQuery.length) {
      throw new EdgeOSApiError(
        `Unknown operation arguments: ${[...unknownPath, ...unknownQuery].join(", ")}`,
        400,
      )
    }

    if (context.popup) {
      if (knownPath.has("popup_id") && pathArgs.popup_id == null) {
        pathArgs.popup_id = context.popup.id
      }
      if (knownQuery.has("popup_id") && queryArgs.popup_id == null) {
        queryArgs.popup_id = context.popup.id
      }
    }

    let body = args.body
    if (
      operation.requestBody &&
      typeof body === "object" &&
      body !== null &&
      !Array.isArray(body)
    ) {
      body = { ...(body as JsonObject) }
      if (
        schemaHasProperty(operation.requestBody.schema, "popup_id") &&
        (body as JsonObject).popup_id == null
      ) {
        if (!context.popup)
          throw new EdgeOSApiError("Select a gathering first", 400)
        ;(body as JsonObject).popup_id = context.popup.id
      }
      if (schemaHasProperty(operation.requestBody.schema, "tenant_id")) {
        ;(body as JsonObject).tenant_id = context.tenantId
      }
    }

    if (operation.requestBody?.required && body === undefined) {
      throw new EdgeOSApiError("This operation requires a JSON body", 400)
    }
    if (!operation.requestBody && body !== undefined) {
      throw new EdgeOSApiError(
        "This operation does not accept a JSON body",
        400,
      )
    }
    for (const parameter of operation.parameters) {
      const container = parameter.location === "path" ? pathArgs : queryArgs
      if (parameter.required && container[parameter.name] == null) {
        throw new EdgeOSApiError(
          `Missing required ${parameter.location} argument: ${parameter.name}`,
          400,
        )
      }
    }

    return { pathArgs, queryArgs, body }
  }

  private operationUrl(
    operation: CatalogOperation,
    pathArgs: JsonObject,
    queryArgs: JsonObject,
  ) {
    let path = operation.path
    const query = new URLSearchParams()
    for (const parameter of operation.parameters) {
      const container = parameter.location === "path" ? pathArgs : queryArgs
      const value = container[parameter.name]
      if (value == null) continue
      if (parameter.location === "path") {
        path = path.replace(
          `{${parameter.name}}`,
          encodeURIComponent(String(value)),
        )
        continue
      }
      for (const item of Array.isArray(value) ? value : [value]) {
        if (!["string", "number", "boolean"].includes(typeof item)) {
          throw new EdgeOSApiError(
            `Invalid query argument: ${parameter.name}`,
            400,
          )
        }
        query.append(parameter.name, String(item))
      }
    }
    return `${this.backendUrl}${path}${query.size ? `?${query.toString()}` : ""}`
  }

  private async executeOnce(
    operation: CatalogOperation,
    context: EdgeOSContext,
    args: OperationArguments,
    options: { toolCallId?: string; abortSignal?: AbortSignal },
  ) {
    const { pathArgs, queryArgs, body } = this.prepareArguments(
      operation,
      context,
      args,
    )

    const effectiveArguments = { path: pathArgs, query: queryArgs, body }
    let operationContext: OperationContext | undefined
    if (operation.method !== "GET") {
      const references = await this.readReferencedRecords(
        context,
        effectiveArguments,
        options.abortSignal,
      )
      operationContext = await this.resolveOperationContext(
        operation,
        context,
        effectiveArguments,
        references.popupIds,
        options.abortSignal,
      )
      this.assertWriteContextResolved(operation, operationContext)
    }

    const response = await fetch(
      this.operationUrl(operation, pathArgs, queryArgs),
      {
        method: operation.method,
        headers: {
          Authorization: context.authorization,
          "X-Tenant-Id": context.tenantId,
          ...(context.popup ? { "X-Popup-Id": context.popup.id } : {}),
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(operation.method !== "GET" && options.toolCallId
            ? {
                "Idempotency-Key": `ai:${context.user.id}:${options.toolCallId}`,
                "X-EdgeOS-AI-Tool-Call-Id": options.toolCallId,
              }
            : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: options.abortSignal,
      },
    )
    if (!response.ok) throw await responseError(response)

    const text = await response.text()
    if (text.length > MAX_RESPONSE_CHARS) {
      throw new EdgeOSApiError(
        "The API response is too large; use narrower filters or pagination",
        413,
      )
    }
    let value: unknown = null
    if (text.trim()) {
      try {
        value = JSON.parse(text)
      } catch {
        throw new EdgeOSApiError("The API returned a non-JSON response", 502)
      }
    }
    operationContext ??= await this.resolveOperationContext(
      operation,
      context,
      effectiveArguments,
      collectPopupIds(value),
      options.abortSignal,
    )

    const result = {
      operation: {
        operationId: operation.operationId,
        method: operation.method,
        summary: operation.summary,
        scope: operation.scope,
        risk: operation.risk,
      },
      status: response.status,
      requestId: response.headers.get("X-Request-Id") ?? undefined,
      context: operationContext,
      arguments: sanitize(effectiveArguments),
      data: sanitize(value),
    }

    console.info(
      JSON.stringify({
        event: "edgeos.ai.operation",
        userId: context.user.id,
        tenantId: context.tenantId,
        popupId: context.popup?.id,
        operationId: operation.operationId,
        method: operation.method,
        toolCallId: options.toolCallId,
        status: response.status,
        requestId: result.requestId,
      }),
    )
    return result
  }

  private referenceReadOperation(parameterName: string) {
    return [...this.operations.values()]
      .filter(
        (operation) =>
          operation.method === "GET" &&
          !operation.requestBody &&
          operation.parameters.some(
            (parameter) =>
              parameter.location === "path" && parameter.name === parameterName,
          ) &&
          operation.parameters
            .filter(
              (parameter) =>
                parameter.location === "path" && parameter.required,
            )
            .every(
              (parameter) =>
                parameter.name === parameterName ||
                parameter.name === "popup_id",
            ),
      )
      .sort((left, right) => {
        const leftGet = normalize(left.summary).startsWith("get") ? 0 : 1
        const rightGet = normalize(right.summary).startsWith("get") ? 0 : 1
        return leftGet - rightGet || left.path.length - right.path.length
      })[0]
  }

  private async readReferencedRecords(
    context: EdgeOSContext,
    args: OperationArguments,
    abortSignal?: AbortSignal,
  ) {
    const entities: OperationPreviewEntity[] = []
    const popupIds = new Set<string>()
    for (const { parameterName, value } of collectUuidReferences(args)) {
      const candidate = this.referenceReadOperation(parameterName)
      if (!candidate) continue
      const result = (await this.executeOnce(
        candidate,
        context,
        { path: { [parameterName]: value } },
        { abortSignal },
      )) as { data?: unknown; context?: OperationContext }
      entities.push(entityFromRecord(parameterName, value, result.data))
      for (const popupId of collectPopupIds(result.data)) popupIds.add(popupId)
      for (const gathering of result.context?.targetGatherings ?? []) {
        popupIds.add(gathering.id)
      }
    }
    return { entities, popupIds }
  }

  private async popupSummary(
    context: EdgeOSContext,
    popupId: string,
    abortSignal?: AbortSignal,
  ) {
    if (context.popup?.id === popupId) return context.popup
    const cacheKey = `${context.tenantId}:${popupId}`
    const cached = this.popupSummaries.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.popup
    const response = await fetch(
      `${this.backendUrl}/api/v1/popups/${encodeURIComponent(popupId)}`,
      {
        headers: {
          Authorization: context.authorization,
          "X-Tenant-Id": context.tenantId,
          Accept: "application/json",
        },
        signal: abortSignal,
      },
    )
    if (!response.ok) throw await responseError(response)
    const popup = (await response.json()) as PopupSummary
    if (popup.tenant_id !== context.tenantId) {
      throw new EdgeOSApiError(
        "The target gathering is outside the current organization",
        403,
      )
    }
    this.popupSummaries.set(cacheKey, {
      popup,
      expiresAt: Date.now() + CACHE_TTL_MS,
    })
    return popup
  }

  private async resolveOperationContext(
    operation: CatalogOperation,
    context: EdgeOSContext,
    args: OperationArguments,
    discoveredPopupIds: Iterable<string>,
    abortSignal?: AbortSignal,
  ): Promise<OperationContext> {
    const popupIds = collectPopupIds(args)
    for (const popupId of discoveredPopupIds) popupIds.add(popupId)
    const targetGatherings = await Promise.all(
      [...popupIds]
        .sort()
        .map((popupId) => this.popupSummary(context, popupId, abortSignal)),
    )
    const activeGathering = context.popup
      ? { id: context.popup.id, name: context.popup.name }
      : undefined
    const createsGathering =
      operation.method === "POST" && operation.path === "/api/v1/popups"
    const resolution: OperationContext["resolution"] = targetGatherings.length
      ? "verified"
      : operation.scope === "organization" || createsGathering
        ? "organization"
        : "unknown"
    return {
      activeGathering,
      targetGatherings: targetGatherings.map(({ id, name }) => ({ id, name })),
      crossContext: Boolean(
        activeGathering &&
          targetGatherings.some(
            (gathering) => gathering.id !== activeGathering.id,
          ),
      ),
      resolution,
    }
  }

  private assertWriteContextResolved(
    operation: CatalogOperation,
    operationContext: OperationContext,
  ) {
    if (operation.scope !== "gathering") return
    if (operationContext.resolution === "unknown") {
      throw new EdgeOSApiError(
        "EdgeOS could not verify which gathering this change would affect",
        409,
      )
    }
    if (operationContext.targetGatherings.length > 1) {
      throw new EdgeOSApiError(
        "The proposed change references records from multiple gatherings",
        409,
      )
    }
  }
}
