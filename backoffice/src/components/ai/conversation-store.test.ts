import { convertToModelMessages, type UIMessage } from "ai"
import { beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({
  list: vi.fn(),
  upsert: vi.fn(),
  remove: vi.fn(),
}))

vi.mock("@/client", () => ({
  AiConversationsService: {
    listAiConversations: api.list,
    upsertAiConversation: api.upsert,
    deleteAiConversation: api.remove,
  },
}))

import {
  activeConversationId,
  clearLegacyConversationStorage,
  compactMessages,
  conversationContextKey,
  loadConversations,
  saveConversation,
  setActiveConversation,
} from "./conversation-store"

const userMessage = (id: string, text: string) =>
  ({ id, role: "user", parts: [{ type: "text", text }] }) as UIMessage

const publicConversation = {
  id: "conversation-1",
  title: "Review pending applications",
  messages: [userMessage("user-1", "Review pending applications")],
  schema_version: 1,
  revision: 2,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  expires_at: "2026-02-01T00:00:00Z",
  usage: {
    input_tokens: 120,
    output_tokens: 40,
    models: ["gpt-edgeos"],
  },
}

describe("assistant conversation store", () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
  })

  it("stores only the active id locally and scopes it by user and tenant", () => {
    const context = conversationContextKey("user-1", "tenant-a")
    setActiveConversation(context, "conversation-1")
    localStorage.setItem("edgeos-ai-conversations-v1", "sensitive legacy data")
    clearLegacyConversationStorage()

    expect(activeConversationId(context)).toBe("conversation-1")
    expect(
      activeConversationId(conversationContextKey("user-2", "tenant-a")),
    ).toBeUndefined()
    expect(
      activeConversationId(conversationContextKey("user-1", "tenant-b")),
    ).toBeUndefined()
    expect(localStorage.getItem("edgeos-ai-conversations-v1")).toBeNull()
  })

  it("loads and saves conversations through the tenant-scoped API", async () => {
    api.list.mockResolvedValue([publicConversation])
    api.upsert.mockResolvedValue(publicConversation)

    await expect(loadConversations("tenant-a")).resolves.toEqual([
      expect.objectContaining({
        id: "conversation-1",
        updatedAt: "2026-01-02T00:00:00Z",
        usage: expect.objectContaining({ input_tokens: 120 }),
      }),
    ])
    await expect(
      saveConversation("tenant-a", "conversation-1", [
        userMessage("user-1", "Review pending applications"),
      ]),
    ).resolves.toEqual(
      expect.objectContaining({ id: "conversation-1", revision: 2 }),
    )
    expect(api.list).toHaveBeenCalledWith({ xTenantId: "tenant-a" })
    expect(api.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conversation-1",
        xTenantId: "tenant-a",
      }),
    )
  })

  it("removes raw results and disables stale approvals before upload", () => {
    const messages = [
      userMessage("user-1", "Accept Carol"),
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-executeOperation",
            toolCallId: "read-1",
            state: "output-available",
            output: {
              operation: {
                operationId: "applications-list_applications",
                method: "GET",
                summary: "List Applications",
              },
              status: 200,
              data: { secret: "must not persist" },
            },
          },
          {
            type: "tool-executeOperation",
            toolCallId: "write-1",
            state: "approval-requested",
            approval: { id: "approval-1", signature: "signed-secret" },
            input: { operationId: "submit_review" },
          },
          {
            type: "tool-executeOperation",
            toolCallId: "write-2",
            state: "approval-responded",
            approval: {
              id: "approval-2",
              approved: true,
              signature: "responded-signed-secret",
            },
            input: { operationId: "submit_review" },
          },
        ],
      } as unknown as UIMessage,
    ]

    const compacted = compactMessages(messages)
    const serialized = JSON.stringify(compacted)

    expect(serialized).not.toContain("must not persist")
    expect(serialized).not.toContain("signed-secret")
    expect(compacted[1]?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: "write-1",
          state: "output-denied",
          approval: expect.objectContaining({ approved: false }),
        }),
        expect.objectContaining({
          toolCallId: "write-2",
          state: "output-denied",
          approval: expect.objectContaining({ approved: false }),
        }),
      ]),
    )
  })

  it("expires prepared files without retaining their plans or arguments", async () => {
    const messages = [
      userMessage("user-1", "Export attendee details"),
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-prepareCustomExport",
            toolCallId: "export-1",
            state: "output-available",
            input: { filters: [{ value: "private@example.com" }] },
            output: {
              spec: { filename: "private-attendee-export" },
              fingerprint: "sensitive-fingerprint",
            },
          },
          {
            type: "tool-executeOperation",
            toolCallId: "download-1",
            state: "output-available",
            input: {
              operationId: "attendees-export_attendees_csv",
              arguments: { query: { search: "private-download@example.com" } },
            },
            output: {
              download: { filename: "attendees.csv" },
            },
          },
        ],
      } as unknown as UIMessage,
    ]

    const compacted = compactMessages(messages)
    const serialized = JSON.stringify(compacted)
    const parts = compacted[1]?.parts ?? []

    expect(serialized).not.toContain("private@example.com")
    expect(serialized).not.toContain("private-download@example.com")
    expect(serialized).not.toContain("sensitive-fingerprint")
    expect(parts[0]).toEqual({
      type: "data-expired-prepared-file",
      data: { persistedState: "expired", kind: "custom-export" },
    })
    expect(parts[1]).toEqual({
      type: "data-expired-prepared-file",
      data: { persistedState: "expired", kind: "download" },
    })

    const modelMessages = await convertToModelMessages(compacted)
    expect(JSON.stringify(modelMessages)).not.toContain("export-1")
    expect(JSON.stringify(modelMessages)).not.toContain("download-1")
  })
})
