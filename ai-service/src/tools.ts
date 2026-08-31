import { type ToolSet, tool } from "ai"
import { z } from "zod"
import { EdgeOSApiError, type EdgeOSContext, responseError } from "./context.js"
import type {
  EdgeOSOperationCatalog,
  OperationArguments,
} from "./operation-catalog.js"
import type { SkillRegistry } from "./skills.js"

const jsonObjectSchema = z.record(z.string(), z.unknown())

export const searchExportFieldsInputSchema = z
  .object({
    query: z
      .string()
      .trim()
      .max(240)
      .optional()
      .describe(
        "Resource, field, or relationship to find using canonical English terms",
      ),
    dataset: z
      .string()
      .trim()
      .max(80)
      .optional()
      .describe(
        "Exact dataset name from an earlier search to inspect all fields",
      ),
  })
  .strict()

const exportFilterSchema = z
  .object({
    field: z.string().trim().min(1).max(120),
    operator: z.enum([
      "eq",
      "neq",
      "contains",
      "not_contains",
      "in",
      "is_empty",
      "not_empty",
      "gt",
      "gte",
      "lt",
      "lte",
      "before",
      "after",
    ]),
    value: z.unknown().optional(),
  })
  .strict()

export const prepareCustomExportInputSchema = z
  .object({
    dataset: z.string().trim().min(1).max(80),
    columns: z
      .array(
        z
          .object({
            field: z.string().trim().min(1).max(120),
            label: z.string().trim().min(1).max(120).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(25),
    filters: z.array(exportFilterSchema).max(20).optional(),
    format: z.enum(["csv", "xlsx"]),
    filename: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .optional()
      .describe("Base filename without a .csv or .xlsx extension"),
  })
  .strict()

export const searchOperationsInputSchema = z
  .object({
    query: z
      .string()
      .max(240)
      .optional()
      .describe(
        "Business intent, resource, and action to find; omit or send an empty string when inspecting an operationId",
      ),
    operationId: z
      .string()
      .max(240)
      .optional()
      .describe(
        "Exact operationId returned by an earlier search; omit or send an empty string when searching",
      ),
    mode: z.enum(["read", "write"]).optional(),
    limit: z.number().int().min(1).max(15).optional(),
  })
  .strict()

export function createEdgeOSTools(
  catalog: EdgeOSOperationCatalog,
  context: EdgeOSContext,
  skills: SkillRegistry,
  backendUrl: string,
) {
  const exportHeaders = () => ({
    Authorization: context.authorization,
    "X-Tenant-Id": context.tenantId,
    ...(context.popup ? { "X-Popup-Id": context.popup.id } : {}),
    Accept: "application/json",
  })
  const fetchExportCatalog = async (abortSignal?: AbortSignal) => {
    const response = await fetch(
      `${backendUrl}/api/v1/custom-exports/catalog`,
      {
        headers: exportHeaders(),
        signal: abortSignal,
      },
    )
    if (!response.ok) throw await responseError(response)
    return (await response.json()) as {
      datasets: Array<{
        dataset: string
        label: string
        description: string
        scope: "organization" | "gathering"
        row_label: string
        fields: Array<{
          field: string
          label: string
          type: string
          sensitivity: string
          filter_operators: string[]
        }>
      }>
      formats: string[]
      limits: Record<string, number>
    }
  }

  return {
    searchOperations: tool({
      description:
        "Search or inspect the live server-owned EdgeOS operation catalog. Search by business intent first; results are compact. Then call this same tool with the exact returned operationId to inspect its complete path/query/body schema before execution. Never invent an operationId. Results include scope, risk, side effects, and relevant workflow skills. Search again with narrower English API terms when needed.",
      inputSchema: searchOperationsInputSchema,
      execute: async ({ query, operationId, mode, limit }) => {
        const normalizedQuery = query?.trim() || undefined
        const normalizedOperationId = operationId?.trim() || undefined
        const hasExactOperation =
          normalizedOperationId !== undefined &&
          catalog.isWrite(normalizedOperationId) !== undefined
        const searchQuery =
          normalizedQuery ?? normalizedOperationId ?? "EdgeOS operations"

        return {
          ...(hasExactOperation
            ? { operation: await catalog.describe(normalizedOperationId) }
            : {
                operations: await catalog.search(searchQuery, limit, mode),
              }),
          workflows: skills.search(searchQuery, 3).map((skill) => ({
            name: skill.name,
            description: skill.description,
            operations: skill.operations,
            instructions: skill.instructions,
          })),
        }
      },
    }),

    searchExportFields: tool({
      description:
        "Search the server-owned custom export catalog. Use this instead of searchOperations when the user wants a custom CSV or XLSX, especially when combining resources. Search broadly first, then inspect the exact dataset to get every valid field and filter operator. Dataset fields may include safe server-defined relationships and aggregates. Never invent dataset or field names.",
      inputSchema: searchExportFieldsInputSchema,
      execute: async ({ query, dataset }, { abortSignal }) => {
        const catalog = await fetchExportCatalog(abortSignal)
        const exactDataset = dataset?.trim()
        if (exactDataset) {
          const match = catalog.datasets.find(
            (candidate) => candidate.dataset === exactDataset,
          )
          if (!match) {
            throw new EdgeOSApiError("Unknown custom export dataset", 404)
          }
          return {
            dataset: match,
            formats: catalog.formats,
            limits: catalog.limits,
          }
        }

        const terms = (query ?? "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .toLowerCase()
          .split(/[^a-z0-9_.]+/)
          .filter((term) => term.length > 1)
        const matches = catalog.datasets
          .map((candidate) => {
            const datasetText =
              `${candidate.dataset} ${candidate.label} ${candidate.description}`.toLowerCase()
            const fields = candidate.fields.filter((field) => {
              const text = `${field.field} ${field.label}`.toLowerCase()
              return !terms.length || terms.some((term) => text.includes(term))
            })
            const score = terms.reduce(
              (total, term) =>
                total +
                (datasetText.includes(term) ? 4 : 0) +
                fields.filter((field) =>
                  `${field.field} ${field.label}`.toLowerCase().includes(term),
                ).length,
              0,
            )
            return { candidate, fields, score }
          })
          .filter(({ score }) => !terms.length || score > 0)
          .sort(
            (left, right) =>
              right.score - left.score ||
              left.candidate.dataset.localeCompare(right.candidate.dataset),
          )
          .slice(0, 6)
          .map(({ candidate, fields }) => ({
            dataset: candidate.dataset,
            label: candidate.label,
            description: candidate.description,
            scope: candidate.scope,
            rowLabel: candidate.row_label,
            matchingFields: fields.slice(0, 12),
            totalFields: candidate.fields.length,
          }))
        return {
          datasets: matches,
          formats: catalog.formats,
          limits: catalog.limits,
        }
      },
    }),

    prepareCustomExport: tool({
      description:
        "Validate and prepare one exact custom CSV or XLSX plan using only dataset and field names returned by searchExportFields. The selected dataset defines one row per root record; related one-to-many data is exposed only through safe server-defined aggregate fields. The active gathering is injected automatically for gathering-scoped datasets. This returns a frozen preview card with exact row count, columns, filters, sensitivity warnings, and a user-controlled download button; it does not download the file by itself.",
      inputSchema: prepareCustomExportInputSchema,
      execute: async (input, { abortSignal }) => {
        const catalog = await fetchExportCatalog(abortSignal)
        const dataset = catalog.datasets.find(
          (candidate) => candidate.dataset === input.dataset,
        )
        if (!dataset) {
          throw new EdgeOSApiError("Unknown custom export dataset", 404)
        }
        if (dataset.scope === "gathering" && !context.popup) {
          throw new EdgeOSApiError("Select a gathering first", 400)
        }
        const response = await fetch(
          `${backendUrl}/api/v1/custom-exports/preview`,
          {
            method: "POST",
            headers: {
              ...exportHeaders(),
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              dataset: input.dataset,
              popup_id:
                dataset.scope === "gathering" ? context.popup?.id : null,
              columns: input.columns,
              filters: input.filters ?? [],
              format: input.format,
              filename: input.filename,
            }),
            signal: abortSignal,
          },
        )
        if (!response.ok) throw await responseError(response)
        return response.json()
      },
    }),

    executeOperation: tool({
      description:
        "Execute one exact EdgeOS operation previously returned by searchOperations. Reads execute automatically; downloadable reads prepare an authenticated download card for the user. In supervised mode every POST, PUT, PATCH, or DELETE pauses for the platform's signed user approval before the exact arguments execute. Pass arguments under path, query, and body exactly as described; never provide URLs, methods, headers, authorization, or tenant IDs. Omitted popup_id fields default to the active gathering; provide a discovered popup_id only when the user explicitly requested another gathering. Resolve human-readable records first and never guess IDs.",
      inputSchema: z
        .object({
          operationId: z
            .string()
            .trim()
            .min(1)
            .max(240)
            .describe("Exact operationId returned by searchOperations"),
          arguments: z
            .object({
              path: jsonObjectSchema.optional(),
              query: jsonObjectSchema.optional(),
              body: z.unknown().optional(),
            })
            .strict()
            .optional()
            .describe("Path, query, and JSON body arguments for the operation"),
        })
        .strict(),
      execute: (
        { operationId, arguments: args },
        { toolCallId, abortSignal },
      ) =>
        catalog.execute(
          operationId,
          context,
          (args ?? {}) as OperationArguments,
          { toolCallId, abortSignal },
        ),
    }),
  } satisfies ToolSet
}

export type EdgeOSTools = ReturnType<typeof createEdgeOSTools>
