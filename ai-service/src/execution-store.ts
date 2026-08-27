import { createHash } from "node:crypto"
import { EdgeOSApiError, type EdgeOSContext, responseError } from "./context.js"

export type ExecutionClaim =
  | { state: "acquired" }
  | { state: "pending" }
  | { state: "completed"; result: unknown }

export interface ExecutionStore {
  claim(
    context: EdgeOSContext,
    toolCallId: string,
    fingerprint: string,
    abortSignal?: AbortSignal,
  ): Promise<ExecutionClaim>
  complete(
    context: EdgeOSContext,
    toolCallId: string,
    fingerprint: string,
    result: unknown,
    abortSignal?: AbortSignal,
  ): Promise<void>
}

/**
 * Backend-owned Redis storage makes approved writes safe across service
 * replicas and restarts. Redis unavailability fails writes closed in FastAPI.
 */
export class BackendExecutionStore implements ExecutionStore {
  constructor(private readonly baseUrl: string) {}

  private executionId(toolCallId: string) {
    return createHash("sha256").update(toolCallId).digest("hex")
  }

  private headers(context: EdgeOSContext) {
    return {
      Authorization: context.authorization,
      "X-Tenant-Id": context.tenantId,
      Accept: "application/json",
      "Content-Type": "application/json",
    }
  }

  async claim(
    context: EdgeOSContext,
    toolCallId: string,
    fingerprint: string,
    abortSignal?: AbortSignal,
  ): Promise<ExecutionClaim> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/ai-executions/${this.executionId(toolCallId)}/claim`,
      {
        method: "POST",
        headers: this.headers(context),
        body: JSON.stringify({ fingerprint }),
        signal: abortSignal,
      },
    )
    if (!response.ok) throw await responseError(response)
    const value = (await response.json()) as {
      state?: unknown
      result?: unknown
    }
    if (value.state === "acquired" || value.state === "pending") {
      return { state: value.state }
    }
    if (value.state === "completed") {
      return { state: "completed", result: value.result }
    }
    throw new EdgeOSApiError("EdgeOS returned an invalid execution claim", 502)
  }

  async complete(
    context: EdgeOSContext,
    toolCallId: string,
    fingerprint: string,
    result: unknown,
    abortSignal?: AbortSignal,
  ): Promise<void> {
    const response = await fetch(
      `${this.baseUrl}/api/v1/ai-executions/${this.executionId(toolCallId)}/complete`,
      {
        method: "POST",
        headers: this.headers(context),
        body: JSON.stringify({ fingerprint, result }),
        signal: abortSignal,
      },
    )
    if (!response.ok) throw await responseError(response)
  }
}

/** Unit-test fallback; production always injects BackendExecutionStore. */
export class MemoryExecutionStore implements ExecutionStore {
  private records = new Map<
    string,
    { fingerprint: string; state: "pending" | "completed"; result?: unknown }
  >()

  private key(context: EdgeOSContext, toolCallId: string) {
    return `${context.user.id}:${context.tenantId}:${toolCallId}`
  }

  async claim(
    context: EdgeOSContext,
    toolCallId: string,
    fingerprint: string,
  ): Promise<ExecutionClaim> {
    const key = this.key(context, toolCallId)
    const record = this.records.get(key)
    if (!record) {
      this.records.set(key, { fingerprint, state: "pending" })
      return { state: "acquired" }
    }
    if (record.fingerprint !== fingerprint) {
      throw new EdgeOSApiError(
        "The approved operation payload cannot be changed",
        409,
      )
    }
    return record.state === "completed"
      ? { state: "completed", result: record.result }
      : { state: "pending" }
  }

  async complete(
    context: EdgeOSContext,
    toolCallId: string,
    fingerprint: string,
    result: unknown,
  ): Promise<void> {
    const key = this.key(context, toolCallId)
    const record = this.records.get(key)
    if (!record || record.fingerprint !== fingerprint) {
      throw new EdgeOSApiError(
        "The AI execution claim is missing or changed",
        409,
      )
    }
    this.records.set(key, { fingerprint, state: "completed", result })
  }
}
