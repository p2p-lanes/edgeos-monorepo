import { convertToModelMessages, type UIMessage } from "ai"
import { beforeEach, describe, expect, it } from "vitest"
import {
  conversationContextKey,
  createConversationId,
  loadActiveConversation,
  loadConversations,
  saveConversation,
  setActiveConversation,
} from "./conversation-store"

const userMessage = (id: string, text: string) =>
  ({ id, role: "user", parts: [{ type: "text", text }] }) as UIMessage

describe("assistant conversation store", () => {
  beforeEach(() => localStorage.clear())

  it("persists and restores user-and-workspace-scoped conversations", () => {
    const id = createConversationId()
    const context = conversationContextKey("user-1", "tenant", "popup-a")
    saveConversation(context, id, [
      userMessage("user-1", "Review pending applications"),
    ])
    setActiveConversation(context, id)

    expect(loadActiveConversation(context)).toMatchObject({
      id,
      title: "Review pending applications",
    })
    expect(
      loadConversations(conversationContextKey("user-2", "tenant", "popup-a")),
    ).toEqual([])
    expect(
      loadConversations(conversationContextKey("user-1", "tenant", "popup-b")),
    ).toEqual([])
  })

  it("removes raw results and disables stale approvals in persisted history", () => {
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
            approval: { id: "approval-1" },
            input: { operationId: "submit_review" },
          },
        ],
      } as unknown as UIMessage,
    ]

    saveConversation("tenant:popup", "conversation-1", messages)
    const serialized = localStorage.getItem("edgeos-ai-conversations-v1") ?? ""
    const restored = loadActiveConversation("tenant:popup")

    expect(serialized).not.toContain("must not persist")
    expect(restored?.messages[1]?.parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          toolCallId: "write-1",
          state: "output-denied",
          approval: expect.objectContaining({ approved: false }),
        }),
      ]),
    )
  })

  it("expires prepared files without persisting their plans or arguments", async () => {
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
            input: {
              dataset: "attendees",
              filters: [
                {
                  field: "attendee.email",
                  operator: "eq",
                  value: "private@example.com",
                },
              ],
            },
            output: {
              title: "Private attendee export",
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
              arguments: {
                query: { search: "private-download@example.com" },
              },
            },
            output: {
              operation: {
                operationId: "attendees-export_attendees_csv",
                method: "GET",
                summary: "Export attendees",
              },
              status: 200,
              download: {
                filename: "attendees.csv",
                arguments: {
                  query: { search: "private-download@example.com" },
                },
              },
            },
          },
        ],
      } as unknown as UIMessage,
    ]

    saveConversation("tenant:popup", "conversation-1", messages)
    const restored = loadActiveConversation("tenant:popup")
    // Re-saving restored history must keep the marker stable rather than
    // converting it into a generic, permanently loading tool output.
    if (restored) {
      saveConversation("tenant:popup", restored.id, restored.messages)
    }

    const serialized = localStorage.getItem("edgeos-ai-conversations-v1") ?? ""
    const parts = (loadActiveConversation("tenant:popup")?.messages[1]?.parts ??
      []) as unknown as Array<Record<string, unknown>>

    expect(serialized).not.toContain("private@example.com")
    expect(serialized).not.toContain("private-download@example.com")
    expect(serialized).not.toContain("sensitive-fingerprint")
    expect(parts[0]).toEqual({
      type: "data-expired-prepared-file",
      data: {
        persistedState: "expired",
        kind: "custom-export",
      },
    })
    expect(parts[1]).toEqual({
      type: "data-expired-prepared-file",
      data: {
        persistedState: "expired",
        kind: "download",
      },
    })

    const modelMessages = await convertToModelMessages(
      loadActiveConversation("tenant:popup")?.messages ?? [],
    )
    expect(JSON.stringify(modelMessages)).not.toContain("export-1")
    expect(JSON.stringify(modelMessages)).not.toContain("download-1")
  })
})
