import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const modelState = vi.hoisted(() => ({ proposalCount: 0 }))

vi.hoisted(() => {
  process.env.AI_PROVIDER = "openai"
  process.env.OPENAI_API_KEY = "test-openai-key"
  process.env.AI_MODEL = "test-model"
  process.env.TOOL_APPROVAL_SECRET = "test-approval-secret"
  process.env.BACKEND_URL = "http://backend:8000"
})

vi.mock("@hono/node-server", () => ({ serve: vi.fn() }))

vi.mock("@ai-sdk/openai", async () => {
  const { simulateReadableStream } = await import("ai")
  const { MockLanguageModelV4 } = await import("ai/test")

  const usage = {
    inputTokens: {
      total: 10,
      noCache: 10,
      cacheRead: undefined,
      cacheWrite: undefined,
    },
    outputTokens: { total: 5, text: 5, reasoning: undefined },
  }

  const model = new MockLanguageModelV4({
    doStream: async ({ prompt }) => {
      const hasToolResult = prompt.some((message) => message.role === "tool")
      if (hasToolResult) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: "text-start" as const, id: "result-text" },
              {
                type: "text-delta" as const,
                id: "result-text",
                delta: "The approved change was processed.",
              },
              { type: "text-end" as const, id: "result-text" },
              {
                type: "finish" as const,
                finishReason: { unified: "stop" as const, raw: undefined },
                usage,
              },
            ],
          }),
        }
      }

      modelState.proposalCount += 1
      const toolCallId = `write-call-${modelState.proposalCount}`
      return {
        stream: simulateReadableStream({
          chunks: [
            {
              type: "tool-call" as const,
              toolCallId,
              toolName: "executeOperation",
              input: JSON.stringify({
                operationId: "add_attendee_ticket",
                arguments: {
                  path: { attendee_id: "attendee-1" },
                  body: {
                    items: [{ product_id: "product-1", quantity: 1 }],
                  },
                },
              }),
            },
            {
              type: "finish" as const,
              finishReason: {
                unified: "tool-calls" as const,
                raw: undefined,
              },
              usage,
            },
          ],
        }),
      }
    },
  })

  return { createOpenAI: () => () => model }
})

import { app } from "./index.js"

const openapi = {
  components: {
    schemas: {
      TicketAdd: {
        type: "object",
        required: ["popup_id", "items"],
        properties: {
          popup_id: { type: "string", format: "uuid" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                product_id: { type: "string" },
                quantity: { type: "integer", minimum: 1 },
              },
            },
          },
        },
      },
    },
  },
  paths: {
    "/api/v1/attendees/{attendee_id}/tickets": {
      post: {
        operationId: "add_attendee_ticket",
        summary: "Add a ticket to an attendee",
        tags: ["attendees"],
        parameters: [
          {
            name: "attendee_id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TicketAdd" },
            },
          },
        },
        responses: { "201": { content: { "application/json": {} } } },
      },
    },
  },
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "X-Request-Id": "request-1",
    },
  })
}

function streamFrom<T>(chunks: T[]) {
  return new ReadableStream<T>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

async function readAssistantMessage(
  response: Response,
  existingMessage?: UIMessage,
): Promise<UIMessage> {
  expect(response.status).toBe(200)
  const responseText = await response.text()
  const chunks = responseText
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice(6))
    .filter((line) => line !== "[DONE]")
    .map((line) => JSON.parse(line) as UIMessageChunk)

  let message: UIMessage | undefined
  for await (const current of readUIMessageStream({
    stream: streamFrom(chunks),
    message: existingMessage,
  })) {
    message = structuredClone(current)
  }
  if (!message) throw new Error("The chat response did not contain a message")
  return message
}

function approvalPart(message: UIMessage) {
  const part = message.parts.find(
    (candidate) => candidate.type === "tool-executeOperation",
  ) as
    | {
        type: "tool-executeOperation"
        toolCallId: string
        state: string
        input: unknown
        approval?: {
          id: string
          approved?: boolean
          signature?: string
        }
      }
    | undefined
  if (!part?.approval) {
    throw new Error(
      `Expected an operation approval: ${JSON.stringify(message.parts)}`,
    )
  }
  return part
}

function answerApproval(
  message: UIMessage,
  approved: boolean,
  signature?: string,
): UIMessage {
  return {
    ...message,
    parts: message.parts.map((part) => {
      if (part.type !== "tool-executeOperation") return part
      const value = part as ReturnType<typeof approvalPart>
      if (!value?.approval) return part
      return {
        ...part,
        state: "approval-responded",
        approval: {
          ...value.approval,
          approved,
          signature: signature ?? value.approval.signature,
        },
      }
    }),
  } as UIMessage
}

function changeApprovedQuantity(message: UIMessage): UIMessage {
  return {
    ...message,
    parts: message.parts.map((part) =>
      part.type === "tool-executeOperation"
        ? {
            ...part,
            input: {
              ...part.input,
              arguments: {
                ...part.input.arguments,
                body: {
                  ...part.input.arguments?.body,
                  items: [{ product_id: "product-1", quantity: 2 }],
                },
              },
            },
          }
        : part,
    ),
  } as UIMessage
}

const userMessage = (id: string): UIMessage => ({
  id,
  role: "user",
  parts: [{ type: "text", text: "Add one ticket to this attendee" }],
})

async function postChat(messages: UIMessage[], popupId = "popup-1") {
  return app.request("/api/ai/chat", {
    method: "POST",
    headers: {
      Authorization: "Bearer user-jwt",
      "Content-Type": "application/json",
      "X-Tenant-Id": "tenant-1",
      "X-Popup-Id": popupId,
    },
    body: JSON.stringify({ messages }),
  })
}

type DurableExecution = {
  fingerprint: string
  state: "pending" | "completed"
  result?: unknown
}

describe("supervised operation HTTP flow", () => {
  let executionStoreAvailable: boolean
  let mutationCount: number
  let claimCount: number
  let completeCount: number
  let executions: Map<string, DurableExecution>

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    vi.spyOn(console, "info").mockImplementation(() => undefined)
    modelState.proposalCount = 0
    executionStoreAvailable = true
    mutationCount = 0
    claimCount = 0
    completeCount = 0
    executions = new Map()

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input)
        if (url.endsWith("/api/v1/users/me")) {
          return jsonResponse({
            id: "user-1",
            email: "admin@example.com",
            role: "admin",
            tenant_id: "tenant-1",
          })
        }
        if (url.includes("/api/v1/popups/")) {
          const id = url.split("/").at(-1)
          return jsonResponse({ id, tenant_id: "tenant-1", name: "Gathering" })
        }
        if (url.endsWith("/openapi.json")) {
          return jsonResponse(openapi)
        }
        if (url.includes("/api/v1/ai-executions/") && url.endsWith("/claim")) {
          claimCount += 1
          if (!executionStoreAvailable) {
            return jsonResponse(
              { detail: "Durable AI write protection is unavailable" },
              503,
            )
          }
          const key = url
          const body = JSON.parse(String(init?.body)) as { fingerprint: string }
          const existing = executions.get(key)
          if (!existing) {
            executions.set(key, {
              fingerprint: body.fingerprint,
              state: "pending",
            })
            return jsonResponse({ state: "acquired", result: null })
          }
          if (existing.fingerprint !== body.fingerprint) {
            return jsonResponse({ detail: "Execution payload changed" }, 409)
          }
          return jsonResponse({
            state: existing.state,
            result: existing.result ?? null,
          })
        }
        if (
          url.includes("/api/v1/ai-executions/") &&
          url.endsWith("/complete")
        ) {
          completeCount += 1
          const claimUrl = url.replace(/\/complete$/, "/claim")
          const body = JSON.parse(String(init?.body)) as {
            fingerprint: string
            result: unknown
          }
          executions.set(claimUrl, {
            fingerprint: body.fingerprint,
            state: "completed",
            result: body.result,
          })
          return new Response(null, { status: 204 })
        }
        if (url.endsWith("/api/v1/attendees/attendee-1/tickets")) {
          mutationCount += 1
          return jsonResponse({ id: "ticket-1", popup_id: "popup-1" }, 201)
        }
        throw new Error(`Unexpected backend request: ${url}`)
      }),
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it("requires signed approval, executes once, replays safely, and rejects denial", async () => {
    const user = userMessage("user-1")
    const proposal = await readAssistantMessage(await postChat([user]))
    const requested = approvalPart(proposal)

    expect(requested.state).toBe("approval-requested")
    expect(requested.approval?.signature).toBeTruthy()
    expect(mutationCount).toBe(0)
    expect(claimCount).toBe(0)

    const approved = answerApproval(proposal, true)
    const executed = await readAssistantMessage(
      await postChat([user, approved]),
      approved,
    )

    expect(executed.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-executeOperation",
          state: "output-available",
        }),
      ]),
    )
    expect(mutationCount).toBe(1)
    expect(claimCount).toBe(1)
    expect(completeCount).toBe(1)

    await readAssistantMessage(await postChat([user, approved]), approved)
    expect(mutationCount).toBe(1)
    expect(claimCount).toBe(1)
    expect(completeCount).toBe(1)

    const denied = answerApproval(proposal, false)
    const rejected = await readAssistantMessage(
      await postChat([user, denied]),
      denied,
    )
    expect(rejected.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-executeOperation",
          state: "output-denied",
        }),
      ]),
    )
    expect(mutationCount).toBe(1)
    expect(claimCount).toBe(1)
  })

  it("rejects a signature from another context and fails closed without the execution store", async () => {
    const firstUser = userMessage("user-signature")
    const proposal = await readAssistantMessage(await postChat([firstUser]))
    const approved = answerApproval(proposal, true)

    const changedContext = await readAssistantMessage(
      await postChat([firstUser, approved], "popup-2"),
      approved,
    )
    expect(changedContext.parts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "output-available" }),
      ]),
    )
    expect(mutationCount).toBe(0)
    expect(claimCount).toBe(0)

    const changedArguments = await readAssistantMessage(
      await postChat([firstUser, changeApprovedQuantity(approved)]),
      approved,
    )
    expect(changedArguments.parts).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ state: "output-available" }),
      ]),
    )
    expect(mutationCount).toBe(0)
    expect(claimCount).toBe(0)

    const secondUser = userMessage("user-store")
    const secondProposal = await readAssistantMessage(
      await postChat([secondUser]),
    )
    executionStoreAvailable = false
    const unavailableApproval = answerApproval(secondProposal, true)
    const unavailable = await readAssistantMessage(
      await postChat([secondUser, unavailableApproval]),
      unavailableApproval,
    )

    expect(unavailable.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "tool-executeOperation",
          state: "output-error",
        }),
      ]),
    )
    expect(claimCount).toBe(1)
    expect(mutationCount).toBe(0)
    expect(completeCount).toBe(0)
  })
})
