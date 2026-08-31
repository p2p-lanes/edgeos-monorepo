import { useRouterState } from "@tanstack/react-router"
import {
  AlertTriangle,
  Download,
  FileSpreadsheet,
  Filter,
  Loader2,
  Rows3,
} from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import { ToolError, ToolShell } from "./ToolShell"
import { isObject, type ToolRendererProps } from "./tool-types"

type ExportPreview = {
  title: string
  dataset: string
  dataset_label: string
  scope: "organization" | "gathering"
  row_label: string
  estimated_rows: number
  columns: Array<{
    field: string
    label: string
    type: string
    sensitivity: string
  }>
  filters: Array<{
    field: string
    operator: string
    value?: unknown
  }>
  warnings: string[]
  format: "csv" | "xlsx"
  filename: string
  spec: Record<string, unknown>
  fingerprint: string
}

function parsePreview(value: unknown): ExportPreview | null {
  if (
    !isObject(value) ||
    typeof value.title !== "string" ||
    typeof value.dataset !== "string" ||
    typeof value.dataset_label !== "string" ||
    (value.scope !== "organization" && value.scope !== "gathering") ||
    typeof value.row_label !== "string" ||
    typeof value.estimated_rows !== "number" ||
    !Array.isArray(value.columns) ||
    !Array.isArray(value.filters) ||
    !Array.isArray(value.warnings) ||
    (value.format !== "csv" && value.format !== "xlsx") ||
    typeof value.filename !== "string" ||
    !isObject(value.spec) ||
    typeof value.fingerprint !== "string"
  ) {
    return null
  }
  return value as unknown as ExportPreview
}

function safeFilename(value: string | undefined, fallback: string) {
  const raw = value?.split(/[\\/]/).pop()
  const filename = raw
    ? [...raw]
        .filter((character) => {
          const code = character.charCodeAt(0)
          return code >= 32 && code !== 127
        })
        .join("")
        .trim()
    : undefined
  return filename || fallback
}

function responseFilename(header: string | null, fallback: string) {
  if (!header) return fallback
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      return safeFilename(decodeURIComponent(encoded), fallback)
    } catch {
      // Fall back to the regular filename parameter.
    }
  }
  const quoted = header.match(/filename="([^"]+)"/i)?.[1]
  const plain = header.match(/filename=([^;]+)/i)?.[1]
  return safeFilename(quoted ?? plain, fallback)
}

function filterValue(value: unknown) {
  if (value === undefined || value === null) return ""
  if (Array.isArray(value)) return value.join(", ")
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

export function CustomExportTool({ part }: ToolRendererProps) {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const { selectedPopupId, effectiveTenantId } = useWorkspace()
  const [downloading, setDownloading] = useState(false)
  const preview = parsePreview(part.output)

  const downloadFile = async () => {
    if (!preview || downloading) return
    setDownloading(true)
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${localStorage.getItem("access_token") ?? ""}`,
        "Content-Type": "application/json",
        "X-EdgeOS-Pathname": pathname,
      }
      if (effectiveTenantId) headers["X-Tenant-Id"] = effectiveTenantId
      if (selectedPopupId) headers["X-Popup-Id"] = selectedPopupId
      const response = await fetch("/api/ai/custom-exports/download", {
        method: "POST",
        headers,
        body: JSON.stringify({
          spec: preview.spec,
          fingerprint: preview.fingerprint,
        }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as unknown
        const detail =
          isObject(body) && typeof body.detail === "string"
            ? body.detail
            : "The export could not be generated"
        throw new Error(detail)
      }
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = objectUrl
      anchor.download = responseFilename(
        response.headers.get("Content-Disposition"),
        preview.filename,
      )
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
      toast.success("Export download started")
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The export could not be generated",
      )
    } finally {
      setDownloading(false)
    }
  }

  if (part.state === "output-error") {
    return (
      <ToolError text={part.errorText ?? "The export could not be prepared"} />
    )
  }

  if (!preview) {
    return (
      <ToolShell label="Designing custom export" status="Working">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Validating fields, filters, and row count…
        </div>
      </ToolShell>
    )
  }

  const format = preview.format.toUpperCase()
  return (
    <ToolShell
      label={preview.title}
      status="Ready"
      complete
      warning={preview.warnings.length > 0}
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[auto_1fr] gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/8 text-primary">
            <FileSpreadsheet className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-display text-lg font-semibold tracking-tight">
                {preview.filename}
              </h3>
              <Badge variant="secondary" className="font-mono text-[9px]">
                {format}
              </Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              One row per {preview.row_label} · {preview.dataset_label} ·{" "}
              {preview.scope === "gathering"
                ? "Current gathering"
                : "Organization"}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 overflow-hidden rounded-lg border bg-muted/15">
          <div className="border-r px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <Rows3 className="size-3" /> Rows
            </div>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
              {preview.estimated_rows.toLocaleString()}
            </p>
          </div>
          <div className="px-3 py-2.5">
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
              <FileSpreadsheet className="size-3" /> Columns
            </div>
            <p className="mt-1 font-mono text-lg font-semibold tabular-nums">
              {preview.columns.length}
            </p>
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-medium">Column ledger</p>
          <div className="max-h-64 divide-y overflow-y-auto rounded-lg border bg-background">
            {preview.columns.map((column, index) => (
              <div
                key={column.field}
                className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2.5"
              >
                <span className="font-mono text-[9px] text-muted-foreground">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium">{column.label}</p>
                  <p className="truncate font-mono text-[9px] text-muted-foreground">
                    {column.field}
                  </p>
                </div>
                {column.sensitivity !== "internal" && (
                  <Badge variant="outline" className="text-[8px] uppercase">
                    {column.sensitivity}
                  </Badge>
                )}
              </div>
            ))}
          </div>
        </div>

        {preview.filters.length > 0 && (
          <details className="group rounded-lg border bg-muted/15">
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium">
              <Filter className="size-3.5 text-primary" />
              {preview.filters.length} filter
              {preview.filters.length === 1 ? "" : "s"}
            </summary>
            <div className="space-y-1 border-t px-3 py-2.5">
              {preview.filters.map((filter, index) => (
                <p
                  key={`${filter.field}-${index}`}
                  className="font-mono text-[10px] text-muted-foreground"
                >
                  {filter.field} {filter.operator} {filterValue(filter.value)}
                </p>
              ))}
            </div>
          </details>
        )}

        {preview.warnings.map((warning) => (
          <div
            key={warning}
            className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-xs leading-5"
          >
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
            <span>{warning}</span>
          </div>
        ))}

        <div className="border-t pt-3">
          <Button
            type="button"
            className="w-full"
            disabled={downloading}
            onClick={downloadFile}
          >
            {downloading ? <Loader2 className="animate-spin" /> : <Download />}
            {downloading
              ? "Generating export…"
              : `Generate and download ${format}`}
          </Button>
          <p className="mt-2 text-center font-mono text-[9px] text-muted-foreground">
            Plan {preview.fingerprint} · generated only when you click
          </p>
        </div>
      </div>
    </ToolShell>
  )
}
