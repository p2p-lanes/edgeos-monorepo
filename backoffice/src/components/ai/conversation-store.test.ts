import type { UIMessage } from "ai"
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
})
