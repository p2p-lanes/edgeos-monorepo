import { useQueryClient } from "@tanstack/react-query"
import { useRouterState } from "@tanstack/react-router"
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  FileDown,
  Loader2,
  Play,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import { ToolError, ToolShell } from "./ToolShell"
import { isObject, type ToolRendererProps } from "./tool-types"

type OperationInput = {
  operationId?: string
  arguments?: {
    path?: Record<string, unknown>
    query?: Record<string, unknown>
    body?: unknown
  }
}

type OperationPreview = {
  operation: {
    operationId: string
    method: string
    summary: string
    scope?: string
    risk?: string
  }
  context: {
    activeGathering?: { id: string; name: string }
    targetGatherings: Array<{ id: string; name: string }>
    crossContext: boolean
    resolution: "verified" | "organization" | "unknown"
  }
  title: string
  actionLabel: string
  entities: Array<{
    role: string
    id: string
    primary: string
    secondary?: string
    details: Array<{ label: string; value: string }>
  }>
  changes: Array<{ label: string; value: string; previousValue?: string }>
  effects: string[]
  warnings: string[]
  technicalDetails: unknown
  fingerprint: string
}

type OperationOutput = {
  operation: {
    operationId: string
    method: string
    summary: string
    scope?: string
    risk?: string
  }
  status: number
  requestId?: string
  context?: OperationPreview["context"]
  arguments?: unknown
  data?: unknown
  download?: {
    endpoint: string
    filename: string
    mediaTypes: string[]
    arguments: OperationInput["arguments"]
  }
}

function parseInput(value: unknown): OperationInput {
  if (!isObject(value)) return {}
  return {
    operationId:
      typeof value.operationId === "string" ? value.operationId : undefined,
    arguments: isObject(value.arguments)
      ? (value.arguments as OperationInput["arguments"])
      : undefined,
  }
}

function parseOutput(value: unknown): OperationOutput | null {
  if (
    !isObject(value) ||
    !isObject(value.operation) ||
    typeof value.operation.operationId !== "string" ||
    typeof value.operation.method !== "string" ||
    typeof value.operation.summary !== "string" ||
    typeof value.status !== "number"
  ) {
    return null
  }
  return value as unknown as OperationOutput
}

function humanize(value?: string) {
  if (!value) return "EdgeOS operation"
  return value
    .replace(/_[a-z0-9]+_api_v1_.+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function pretty(value: unknown) {
  if (value === undefined) return "—"
  const text = JSON.stringify(value, null, 2)
  return text.length > 6000 ? `${text.slice(0, 6000)}\n…` : text
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
  if (!header) return safeFilename(undefined, fallback)
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i)?.[1]
  if (encoded) {
    try {
      return safeFilename(decodeURIComponent(encoded), fallback)
    } catch {
      // Fall back to a regular filename parameter.
    }
  }
  const quoted = header.match(/filename="([^"]+)"/i)?.[1]
  const plain = header.match(/filename=([^;]+)/i)?.[1]
  return safeFilename(quoted ?? plain, fallback)
}

function parsePreview(value: unknown): OperationPreview | null {
  if (
    !isObject(value) ||
    !isObject(value.operation) ||
    typeof value.title !== "string" ||
    typeof value.actionLabel !== "string" ||
    !Array.isArray(value.entities) ||
    !Array.isArray(value.changes) ||
    !Array.isArray(value.effects) ||
    !Array.isArray(value.warnings) ||
    typeof value.fingerprint !== "string"
  ) {
    return null
  }
  return value as unknown as OperationPreview
}

function ArgumentsPreview({ input }: { input: OperationInput }) {
  const entries = Object.entries(input.arguments ?? {}).filter(
    ([, value]) => value !== undefined,
  )
  return (
    <div className="space-y-3">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Operation
        </p>
        <p className="mt-0.5 font-semibold">{humanize(input.operationId)}</p>
        {input.operationId && (
          <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
            {input.operationId}
          </p>
        )}
      </div>
      {entries.length > 0 && (
        <div className="divide-y rounded-md border bg-muted/20">
          {entries.map(([location, value]) => (
            <div key={location} className="px-3 py-2.5">
              <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {location}
              </p>
              <pre className="thin-scrollbar mt-1 max-h-52 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-5">
                {pretty(value)}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function initials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("")
}

function ApprovalPreview({ preview }: { preview: OperationPreview }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-medium text-warning">Approval required</p>
        <h3 className="mt-1 font-display text-xl font-semibold tracking-tight">
          {preview.title}
        </h3>
        {preview.context.targetGatherings.length > 0 ? (
          <div className="mt-2 space-y-1 text-xs text-muted-foreground">
            {preview.context.activeGathering && (
              <p>Active gathering · {preview.context.activeGathering.name}</p>
            )}
            <p
              className={
                preview.context.crossContext
                  ? "font-medium text-warning"
                  : undefined
              }
            >
              Affected gathering ·{" "}
              {preview.context.targetGatherings
                .map((gathering) => gathering.name)
                .join(", ")}
            </p>
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">
            Organization-wide operation
          </p>
        )}
      </div>

      {preview.entities.length > 0 && (
        <div className="overflow-hidden rounded-lg border bg-background">
          {preview.entities.map((entity) => (
            <div
              key={`${entity.role}-${entity.id}`}
              className="flex gap-3 border-b px-3 py-3 last:border-b-0"
            >
              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                {initials(entity.primary) || "EO"}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  {entity.role}
                </p>
                <p className="truncate text-sm font-semibold">
                  {entity.primary}
                </p>
                {entity.secondary && (
                  <p className="truncate text-xs text-muted-foreground">
                    {entity.secondary}
                  </p>
                )}
                {entity.details.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {entity.details.map((detail) => (
                      <span
                        key={detail.label}
                        className="rounded-md bg-muted px-2 py-1 text-[10px] text-muted-foreground"
                      >
                        {detail.label}:{" "}
                        <strong className="font-medium text-foreground">
                          {detail.value}
                        </strong>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {preview.changes.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium">Proposed change</p>
          <div className="divide-y overflow-hidden rounded-lg border bg-background">
            {preview.changes.map((change, index) => (
              <div
                key={`${change.label}-${index}`}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] items-center gap-3 px-3 py-2.5"
              >
                <p className="text-xs text-muted-foreground">{change.label}</p>
                <div className="flex min-w-0 items-center justify-end gap-2 text-right text-sm">
                  {change.previousValue && (
                    <>
                      <span className="truncate text-muted-foreground line-through">
                        {change.previousValue}
                      </span>
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                    </>
                  )}
                  <strong className="min-w-0 font-semibold">
                    {change.value}
                  </strong>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <p className="mb-2 text-xs font-medium">What will happen</p>
        <div className="space-y-2 rounded-lg border border-primary/15 bg-primary/[0.035] p-3">
          {preview.effects.map((effect) => (
            <div
              key={effect}
              className="flex items-start gap-2 text-xs leading-5"
            >
              <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>{effect}</span>
            </div>
          ))}
        </div>
      </div>

      {preview.warnings.map((warning) => (
        <div
          key={warning}
          className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-xs leading-5"
        >
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-warning" />
          <span>{warning}</span>
        </div>
      ))}

      <details className="group rounded-lg border bg-muted/15">
        <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-xs font-medium text-muted-foreground">
          Technical details
          <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
        </summary>
        <div className="border-t px-3 py-2.5">
          <p className="mb-2 font-mono text-[9px] text-muted-foreground">
            Approval fingerprint {preview.fingerprint}
          </p>
          <pre className="thin-scrollbar max-h-52 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-5">
            {pretty(preview.technicalDetails)}
          </pre>
        </div>
      </details>
    </div>
  )
}

export function OperationExecutionTool({
  part,
  onApproval,
}: ToolRendererProps) {
  const queryClient = useQueryClient()
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const { selectedPopupId, effectiveTenantId } = useWorkspace()
  const invalidated = useRef<string | undefined>(undefined)
  const [preview, setPreview] = useState<OperationPreview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const [downloading, setDownloading] = useState(false)
  const input = parseInput(part.input)
  const output = parseOutput(part.output)
  const approval = part.approval
  const awaitingDecision = Boolean(
    part.state === "approval-requested" && approval && !approval.isAutomatic,
  )
  const previewPayload = JSON.stringify({
    operationId: input.operationId,
    arguments: input.arguments ?? {},
  })

  const downloadFile = async () => {
    if (!output?.download || !input.operationId || downloading) return
    setDownloading(true)
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${localStorage.getItem("access_token") ?? ""}`,
        "Content-Type": "application/json",
        "X-EdgeOS-Pathname": pathname,
      }
      if (effectiveTenantId) headers["X-Tenant-Id"] = effectiveTenantId
      if (selectedPopupId) headers["X-Popup-Id"] = selectedPopupId
      const response = await fetch("/api/ai/downloads", {
        method: "POST",
        headers,
        body: JSON.stringify({
          operationId: input.operationId,
          arguments: output.download.arguments ?? {},
        }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as unknown
        const detail =
          isObject(body) && typeof body.detail === "string"
            ? body.detail
            : "The file could not be downloaded"
        throw new Error(detail)
      }
      const blob = await response.blob()
      const objectUrl = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = objectUrl
      anchor.download = responseFilename(
        response.headers.get("Content-Disposition"),
        output.download.filename,
      )
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
      toast.success("Download started")
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "The file could not be downloaded",
      )
    } finally {
      setDownloading(false)
    }
  }

  useEffect(() => {
    if (
      output &&
      output.operation.method !== "GET" &&
      invalidated.current !== part.toolCallId
    ) {
      invalidated.current = part.toolCallId
      queryClient.invalidateQueries()
    }
  }, [output, part.toolCallId, queryClient])

  useEffect(() => {
    if (!awaitingDecision || !input.operationId) return
    if (previewAttempt > 0) setPreview(null)
    const controller = new AbortController()
    const loadPreview = async () => {
      setPreviewLoading(true)
      setPreviewError(null)
      try {
        const headers: Record<string, string> = {
          Authorization: `Bearer ${localStorage.getItem("access_token") ?? ""}`,
          "Content-Type": "application/json",
          "X-EdgeOS-Pathname": pathname,
        }
        if (effectiveTenantId) headers["X-Tenant-Id"] = effectiveTenantId
        if (selectedPopupId) headers["X-Popup-Id"] = selectedPopupId
        const response = await fetch("/api/ai/operations/preview", {
          method: "POST",
          headers,
          body: previewPayload,
          signal: controller.signal,
        })
        const body = (await response.json()) as unknown
        if (!response.ok) {
          const detail =
            isObject(body) && typeof body.detail === "string"
              ? body.detail
              : "EdgeOS could not verify this change"
          throw new Error(detail)
        }
        const parsed = parsePreview(body)
        if (!parsed) throw new Error("EdgeOS returned an invalid preview")
        setPreview(parsed)
      } catch (error) {
        if (controller.signal.aborted) return
        setPreview(null)
        setPreviewError(
          error instanceof Error
            ? error.message
            : "EdgeOS could not verify this change",
        )
      } finally {
        if (!controller.signal.aborted) setPreviewLoading(false)
      }
    }
    loadPreview()
    return () => controller.abort()
  }, [
    awaitingDecision,
    effectiveTenantId,
    input.operationId,
    pathname,
    previewAttempt,
    previewPayload,
    selectedPopupId,
  ])

  if (part.state === "output-error") {
    return (
      <ToolError
        text={part.errorText ?? "The EdgeOS operation could not be completed"}
      />
    )
  }

  if (part.state === "output-denied") {
    return (
      <ToolShell label={humanize(input.operationId)} status="Not approved">
        <p className="text-sm text-muted-foreground">
          No changes were made in EdgeOS.
        </p>
      </ToolShell>
    )
  }

  if (output?.download) {
    const mediaType = output.download.mediaTypes[0] ?? "downloadable file"
    return (
      <ToolShell label={output.operation.summary} status="Ready" complete>
        <div className="space-y-3">
          <div className="flex items-start gap-3 text-sm">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileDown className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">File ready to download</p>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">
                {output.download.filename} · {mediaType}
              </p>
              {output.context?.targetGatherings.length ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Gathering ·{" "}
                  {output.context.targetGatherings
                    .map((gathering) => gathering.name)
                    .join(", ")}
                </p>
              ) : null}
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            className="w-full"
            disabled={downloading}
            onClick={downloadFile}
          >
            {downloading ? <Loader2 className="animate-spin" /> : <FileDown />}
            {downloading ? "Preparing download…" : "Download file"}
          </Button>
        </div>
      </ToolShell>
    )
  }

  if (output) {
    const isWrite = output.operation.method !== "GET"
    return (
      <ToolShell
        label={output.operation.summary}
        status={isWrite ? "Completed" : "Read"}
        complete
      >
        <div className="space-y-3">
          <div className="flex items-start gap-2 text-sm">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
            <div>
              <p className="font-medium">
                {isWrite ? "Change completed" : "Information retrieved"}
              </p>
              <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                EdgeOS confirmed the operation successfully.
              </p>
              {output.context?.targetGatherings.length ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Gathering ·{" "}
                  {output.context.targetGatherings
                    .map((gathering) => gathering.name)
                    .join(", ")}
                </p>
              ) : null}
            </div>
          </div>
          <details className="group rounded-lg border bg-muted/15">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-xs font-medium text-muted-foreground">
              Technical details
              <ChevronRight className="size-3.5 transition-transform group-open:rotate-90" />
            </summary>
            <div className="space-y-2 border-t px-3 py-2.5">
              <p className="font-mono text-[9px] text-muted-foreground">
                {output.operation.method} · HTTP {output.status}
                {output.requestId ? ` · Request ${output.requestId}` : ""}
              </p>
              {output.data !== null && output.data !== undefined && (
                <pre className="thin-scrollbar max-h-52 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-5">
                  {pretty(output.data)}
                </pre>
              )}
            </div>
          </details>
        </div>
      </ToolShell>
    )
  }

  return (
    <ToolShell
      label={awaitingDecision ? "Review before continuing" : "Operating EdgeOS"}
      status={
        awaitingDecision
          ? previewLoading
            ? "Verifying"
            : "Approval required"
          : "Working"
      }
      warning={Boolean(preview?.warnings.length)}
    >
      {awaitingDecision && previewLoading && (
        <div className="flex min-h-28 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Verifying people, records, and impact…
        </div>
      )}
      {awaitingDecision && previewError && (
        <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-3">
          <div className="flex items-start gap-2 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            <div>
              <p className="font-medium">This change could not be verified</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {previewError}
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => setPreviewAttempt((attempt) => attempt + 1)}
          >
            <RotateCcw /> Try again
          </Button>
        </div>
      )}
      {awaitingDecision && preview && !previewLoading && (
        <ApprovalPreview preview={preview} />
      )}
      {part.state === "approval-responded" && preview ? (
        <ApprovalPreview preview={preview} />
      ) : (
        !awaitingDecision && <ArgumentsPreview input={input} />
      )}
      {awaitingDecision && approval && (
        <div className="mt-4 flex gap-2 border-t pt-3">
          <Button
            size="sm"
            variant="outline"
            className="flex-1"
            onClick={() => onApproval(approval.id, false)}
          >
            <X /> Cancel
          </Button>
          <Button
            size="sm"
            className="h-auto min-h-8 flex-1 whitespace-normal py-2 leading-4"
            disabled={!preview || previewLoading || Boolean(previewError)}
            onClick={() => onApproval(approval.id, true)}
          >
            {preview ? <ShieldCheck /> : <Check />}
            {preview?.actionLabel ?? "Confirm change"}
          </Button>
        </div>
      )}
      {part.state === "approval-responded" && approval?.approved && (
        <div className="mt-3 flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />
          Approved. Executing the immutable operation…
        </div>
      )}
      {!awaitingDecision && part.state !== "approval-responded" && (
        <div className="mt-3 flex items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
          <Play className="size-3.5" /> Executing an authorized read…
        </div>
      )}
    </ToolShell>
  )
}
