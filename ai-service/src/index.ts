import { createGoogleGenerativeAI } from "@ai-sdk/google"
import { createOpenAI } from "@ai-sdk/openai"
import { serve } from "@hono/node-server"
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  isStepCount,
  type ModelMessage,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai"
import { Hono } from "hono"
import { bodyLimit } from "hono/body-limit"
import { loadConfig } from "./config.js"
import {
  approvalSecretForContext,
  EdgeOSApiError,
  EdgeOSContextResolver,
  type RequestIdentity,
  responseError,
} from "./context.js"
import { BackendExecutionStore } from "./execution-store.js"
import {
  EdgeOSOperationCatalog,
  type OperationArguments,
} from "./operation-catalog.js"
import { SkillRegistry } from "./skills.js"
import { buildSystemPrompt } from "./system-prompt.js"
import { createEdgeOSTools } from "./tools.js"

const config = loadConfig()
const contextResolver = new EdgeOSContextResolver(config.backendUrl)
const operationCatalog = new EdgeOSOperationCatalog(
  config.backendUrl,
  new BackendExecutionStore(config.backendUrl),
)
const skills = new SkillRegistry()
const skillsReady = skills.load()
const model =
  config.provider === "openai"
    ? config.openaiApiKey
      ? createOpenAI({ apiKey: config.openaiApiKey })(config.model)
      : null
    : config.geminiApiKey
      ? createGoogleGenerativeAI({ apiKey: config.geminiApiKey })(config.model)
      : null
const app = new Hono()

const MAX_MESSAGES = 100
const MAX_REQUEST_BYTES = 512_000
const MAX_PREVIEW_BYTES = 64_000
const MAX_DOWNLOAD_REQUEST_BYTES = 128_000
const MAX_FEEDBACK_BYTES = 4_000

function deniedApprovalIdsSinceLastUser(messages: ModelMessage[]): string[] {
  const lastUserIndex = messages.findLastIndex(
    (message) => message.role === "user",
  )
  return messages.slice(lastUserIndex + 1).flatMap((message) => {
    if (message.role !== "tool") return []
    return message.content.flatMap((part) =>
      part.type === "tool-approval-response" && part.approved === false
        ? [part.approvalId]
        : [],
    )
  })
}

function toolCallIdsForApprovals(
  messages: UIMessage[],
  approvalIds: string[],
): string[] {
  const deniedIds = new Set(approvalIds)
  return messages.flatMap((message) =>
    message.parts.flatMap((rawPart) => {
      const part = rawPart as unknown as {
        toolCallId?: unknown
        approval?: { id?: unknown }
      }
      return typeof part.toolCallId === "string" &&
        typeof part.approval?.id === "string" &&
        deniedIds.has(part.approval.id)
        ? [part.toolCallId]
        : []
    }),
  )
}

function userMessageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
}

function latestUserText(messages: UIMessage[]) {
  const message = messages.findLast((item) => item.role === "user")
  return message ? userMessageText(message) : ""
}

export function recentUserIntent(messages: UIMessage[], limit = 4) {
  return messages
    .filter((message) => message.role === "user")
    .slice(-limit)
    .map(userMessageText)
    .filter(Boolean)
    .join("\n")
    .slice(-2_000)
}

type OperationHint = {
  operationId: string
  method: string
  summary: string
  scope: string
  arguments: {
    body?: { fields?: string[] }
  }
}

export function formatOperationHints(operations: OperationHint[]) {
  if (!operations.length)
    return "- No close match. Search the catalog directly."
  return operations
    .map((operation) => {
      const fields = operation.arguments.body?.fields?.slice(0, 24) ?? []
      const body = fields.length ? `; body fields: ${fields.join(", ")}` : ""
      return `- ${operation.operationId} | ${operation.method} | ${operation.summary} | ${operation.scope}${body}`
    })
    .join("\n")
}

function operationIdFromToolInput(input: unknown) {
  if (typeof input !== "object" || input === null) return undefined
  const operationId = (input as { operationId?: unknown }).operationId
  return typeof operationId === "string" ? operationId : undefined
}

app.get("/health-check", (c) => c.json({ status: "ok" }))

app.post(
  "/api/ai/feedback",
  bodyLimit({
    maxSize: MAX_FEEDBACK_BYTES,
    onError: (c) => c.json({ detail: "Feedback request is too large" }, 413),
  }),
  async (c) => {
    const identity: RequestIdentity = {
      authorization: c.req.header("authorization") ?? "",
      requestedTenantId: c.req.header("x-tenant-id"),
      popupId: c.req.header("x-popup-id"),
      pathname: c.req.header("x-edgeos-pathname"),
    }
    try {
      const context = await contextResolver.resolve(identity)
      const body = (await c.req.json()) as {
        messageId?: unknown
        rating?: unknown
      }
      if (
        typeof body.messageId !== "string" ||
        body.messageId.length > 200 ||
        (body.rating !== "up" && body.rating !== "down")
      ) {
        return c.json({ detail: "Invalid feedback request" }, 400)
      }
      console.info(
        JSON.stringify({
          event: "edgeos.ai.feedback",
          userId: context.user.id,
          tenantId: context.tenantId,
          popupId: context.popup?.id,
          messageId: body.messageId,
          rating: body.rating,
        }),
      )
      return c.json({ recorded: true })
    } catch (error) {
      if (error instanceof EdgeOSApiError) {
        const status = [400, 401, 403, 404].includes(error.status)
          ? (error.status as 400 | 401 | 403 | 404)
          : 502
        return c.json({ detail: error.message }, status)
      }
      console.error("AI feedback failed", error)
      return c.json({ detail: "Feedback could not be recorded" }, 500)
    }
  },
)

app.post(
  "/api/ai/operations/preview",
  bodyLimit({
    maxSize: MAX_PREVIEW_BYTES,
    onError: (c) => c.json({ detail: "Preview request is too large" }, 413),
  }),
  async (c) => {
    const identity: RequestIdentity = {
      authorization: c.req.header("authorization") ?? "",
      requestedTenantId: c.req.header("x-tenant-id"),
      popupId: c.req.header("x-popup-id"),
      pathname: c.req.header("x-edgeos-pathname"),
    }

    try {
      const context = await contextResolver.resolve(identity)
      const body = (await c.req.json()) as {
        operationId?: unknown
        arguments?: unknown
      }
      if (
        typeof body.operationId !== "string" ||
        typeof body.arguments !== "object" ||
        body.arguments === null ||
        Array.isArray(body.arguments)
      ) {
        return c.json({ detail: "Invalid operation preview request" }, 400)
      }
      const preview = await operationCatalog.preview(
        body.operationId,
        context,
        body.arguments as OperationArguments,
        c.req.raw.signal,
      )
      return c.json(preview)
    } catch (error) {
      if (error instanceof EdgeOSApiError) {
        const status = [400, 401, 403, 404, 409, 413, 422, 429].includes(
          error.status,
        )
          ? (error.status as 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429)
          : 502
        return c.json({ detail: error.message }, status)
      }
      console.error("AI operation preview failed", error)
      return c.json({ detail: "The operation preview is unavailable" }, 500)
    }
  },
)

app.post(
  "/api/ai/downloads",
  bodyLimit({
    maxSize: MAX_DOWNLOAD_REQUEST_BYTES,
    onError: (c) => c.json({ detail: "Download request is too large" }, 413),
  }),
  async (c) => {
    const identity: RequestIdentity = {
      authorization: c.req.header("authorization") ?? "",
      requestedTenantId: c.req.header("x-tenant-id"),
      popupId: c.req.header("x-popup-id"),
      pathname: c.req.header("x-edgeos-pathname"),
    }
    try {
      const context = await contextResolver.resolve(identity)
      const body = (await c.req.json()) as {
        operationId?: unknown
        arguments?: unknown
      }
      if (
        typeof body.operationId !== "string" ||
        typeof body.arguments !== "object" ||
        body.arguments === null ||
        Array.isArray(body.arguments)
      ) {
        return c.json({ detail: "Invalid download request" }, 400)
      }
      const upstream = await operationCatalog.download(
        body.operationId,
        context,
        body.arguments as OperationArguments,
        c.req.raw.signal,
      )
      const headers = new Headers({
        "Cache-Control": "private, no-store",
        "Content-Type":
          upstream.headers.get("Content-Type") ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      })
      // Fetch transparently decompresses upstream gzip responses, so do not
      // forward the upstream Content-Length or Content-Encoding.
      for (const name of ["Content-Disposition", "X-Request-Id"]) {
        const value = upstream.headers.get(name)
        if (value) headers.set(name, value)
      }
      return new Response(upstream.body, {
        status: upstream.status,
        headers,
      })
    } catch (error) {
      if (error instanceof EdgeOSApiError) {
        const status = [
          400, 401, 403, 404, 409, 413, 415, 422, 429, 502,
        ].includes(error.status)
          ? (error.status as
              | 400
              | 401
              | 403
              | 404
              | 409
              | 413
              | 415
              | 422
              | 429
              | 502)
          : 502
        return c.json({ detail: error.message }, status)
      }
      console.error("AI download failed", error)
      return c.json({ detail: "The file could not be downloaded" }, 500)
    }
  },
)

app.post(
  "/api/ai/custom-exports/download",
  bodyLimit({
    maxSize: MAX_DOWNLOAD_REQUEST_BYTES,
    onError: (c) => c.json({ detail: "Export request is too large" }, 413),
  }),
  async (c) => {
    const identity: RequestIdentity = {
      authorization: c.req.header("authorization") ?? "",
      requestedTenantId: c.req.header("x-tenant-id"),
      popupId: c.req.header("x-popup-id"),
      pathname: c.req.header("x-edgeos-pathname"),
    }
    try {
      const context = await contextResolver.resolve(identity)
      const body = (await c.req.json()) as {
        spec?: unknown
        fingerprint?: unknown
      }
      if (
        typeof body.spec !== "object" ||
        body.spec === null ||
        Array.isArray(body.spec) ||
        typeof body.fingerprint !== "string"
      ) {
        return c.json({ detail: "Invalid custom export request" }, 400)
      }
      const upstream = await fetch(
        `${config.backendUrl}/api/v1/custom-exports/download`,
        {
          method: "POST",
          headers: {
            Authorization: context.authorization,
            "X-Tenant-Id": context.tenantId,
            ...(context.popup ? { "X-Popup-Id": context.popup.id } : {}),
            Accept:
              "text/csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: c.req.raw.signal,
        },
      )
      if (!upstream.ok) throw await responseError(upstream)
      const contentType =
        upstream.headers.get("Content-Type")?.split(";", 1)[0]?.toLowerCase() ??
        ""
      const allowed = new Set([
        "text/csv",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ])
      if (!allowed.has(contentType)) {
        await upstream.body?.cancel().catch(() => undefined)
        throw new EdgeOSApiError(
          "EdgeOS returned an unexpected export type",
          502,
        )
      }
      const headers = new Headers({
        "Cache-Control": "private, no-store",
        "Content-Type": upstream.headers.get("Content-Type") ?? contentType,
        "X-Content-Type-Options": "nosniff",
      })
      for (const name of ["Content-Disposition", "X-Request-Id"]) {
        const value = upstream.headers.get(name)
        if (value) headers.set(name, value)
      }
      return new Response(upstream.body, {
        status: upstream.status,
        headers,
      })
    } catch (error) {
      if (error instanceof EdgeOSApiError) {
        const status = [400, 401, 403, 404, 409, 413, 422, 429, 502].includes(
          error.status,
        )
          ? (error.status as
              | 400
              | 401
              | 403
              | 404
              | 409
              | 413
              | 422
              | 429
              | 502)
          : 502
        return c.json({ detail: error.message }, status)
      }
      console.error("Custom export download failed", error)
      return c.json({ detail: "The export could not be generated" }, 500)
    }
  },
)

app.post(
  "/api/ai/chat",
  bodyLimit({
    maxSize: MAX_REQUEST_BYTES,
    onError: (c) => c.json({ detail: "Chat request is too large" }, 413),
  }),
  async (c) => {
    if (!model || !config.toolApprovalSecret) {
      return c.json({ detail: "The assistant is not configured" }, 503)
    }

    const identity: RequestIdentity = {
      authorization: c.req.header("authorization") ?? "",
      requestedTenantId: c.req.header("x-tenant-id"),
      popupId: c.req.header("x-popup-id"),
      pathname: c.req.header("x-edgeos-pathname"),
    }

    try {
      await skillsReady
      const context = await contextResolver.resolve(identity)
      const body = (await c.req.json()) as { messages?: unknown }
      if (
        !Array.isArray(body.messages) ||
        body.messages.length > MAX_MESSAGES
      ) {
        return c.json({ detail: "Invalid chat message history" }, 400)
      }

      const messages = body.messages as UIMessage[]
      if (
        messages.some(
          (message) => message.role !== "user" && message.role !== "assistant",
        )
      ) {
        return c.json({ detail: "Invalid chat message role" }, 400)
      }

      const userRequest = latestUserText(messages)
      const conversationIntent = recentUserIntent(messages)
      const preflightOperations = conversationIntent.trim()
        ? await operationCatalog.search(conversationIntent, 5)
        : []
      const operationHints = formatOperationHints(preflightOperations)
      const tools = createEdgeOSTools(
        operationCatalog,
        context,
        skills,
        config.backendUrl,
      )
      const modelMessages = await convertToModelMessages(messages, { tools })
      const deniedApprovalIds = deniedApprovalIdsSinceLastUser(modelMessages)
      if (deniedApprovalIds.length > 0) {
        const deniedToolCallIds = toolCallIdsForApprovals(
          messages,
          deniedApprovalIds,
        )
        return createUIMessageStreamResponse({
          stream: createUIMessageStream({
            originalMessages: messages,
            execute: ({ writer }) => {
              writer.write({ type: "start" })
              for (const toolCallId of deniedToolCallIds) {
                writer.write({ type: "tool-output-denied", toolCallId })
              }
              writer.write({ type: "finish" })
            },
          }),
          headers: {
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
          },
        })
      }

      const result = streamText({
        model,
        system: buildSystemPrompt(
          context,
          skills.relevantInstructions(userRequest),
          operationHints,
        ),
        messages: modelMessages,
        tools,
        stopWhen: isStepCount(20),
        toolApproval: async ({ toolCall, messages: approvalMessages }) => {
          if (!toolCall || toolCall.toolName !== "executeOperation") {
            return "not-applicable"
          }
          const operationId = operationIdFromToolInput(toolCall.input)
          if (!operationId) {
            return { type: "denied", reason: "Invalid EdgeOS operation" }
          }
          const operation = await operationCatalog
            .get(operationId)
            .catch(() => null)
          if (!operation) {
            return { type: "denied", reason: "Unknown EdgeOS operation" }
          }
          if (operation.method === "GET") return "not-applicable"
          if (deniedApprovalIdsSinceLastUser(approvalMessages).length > 0) {
            return {
              type: "denied",
              reason: "The user already rejected this operation",
            }
          }
          return "user-approval"
        },
        experimental_toolApprovalSecret: approvalSecretForContext(
          config.toolApprovalSecret,
          context,
        ),
        abortSignal: c.req.raw.signal,
      })

      return createUIMessageStreamResponse({
        stream: toUIMessageStream({
          stream: result.stream,
          tools,
          originalMessages: messages,
          onError: (error) => {
            console.error("AI stream failed", error)
            return "The assistant could not complete this request. Try again."
          },
        }),
        headers: {
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        },
      })
    } catch (error) {
      if (error instanceof EdgeOSApiError) {
        const status = [400, 401, 403, 404, 409, 413, 422, 429].includes(
          error.status,
        )
          ? (error.status as 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429)
          : 502
        return c.json({ detail: error.message }, status)
      }
      console.error("AI chat request failed", error)
      return c.json({ detail: "The assistant is temporarily unavailable" }, 500)
    }
  },
)

app.notFound((c) => c.json({ detail: "Not found" }, 404))
app.onError((error, c) => {
  console.error("Unhandled AI service error", error)
  return c.json({ detail: "The assistant is temporarily unavailable" }, 500)
})

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`EdgeOS AI service listening on http://localhost:${info.port}`)
})
