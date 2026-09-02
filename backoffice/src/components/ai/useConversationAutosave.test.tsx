import { act, renderHook } from "@testing-library/react"
import type { UIMessage } from "ai"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const api = vi.hoisted(() => ({
  save: vi.fn(),
}))

vi.mock("./conversation-store", async (importOriginal) => {
  const original = await importOriginal<typeof import("./conversation-store")>()
  return {
    ...original,
    saveConversation: api.save,
  }
})

import type { StoredConversation } from "./conversation-store"
import { useConversationAutosave } from "./useConversationAutosave"

const userMessage = (id: string, text: string) =>
  ({ id, role: "user", parts: [{ type: "text", text }] }) as UIMessage

const savedConversation = (messages: UIMessage[]): StoredConversation => ({
  id: "conversation-1",
  title: "Saved conversation",
  updatedAt: "2026-09-02T20:30:00Z",
  expiresAt: "2026-10-02T20:30:00Z",
  revision: 1,
  messages,
  usage: {},
})

async function advanceAutosave() {
  await act(async () => {
    vi.advanceTimersByTime(400)
    await Promise.resolve()
  })
}

describe("useConversationAutosave", () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("does not save a restored conversation until its messages change", async () => {
    const initialMessages = [userMessage("user-1", "Existing conversation")]
    api.save.mockResolvedValue(savedConversation(initialMessages))

    renderHook(() =>
      useConversationAutosave({
        tenantId: "tenant-1",
        conversationId: "conversation-1",
        initialMessages,
        messages: initialMessages,
        status: "ready",
        onPersist: vi.fn(),
        onError: vi.fn(),
      }),
    )

    await advanceAutosave()

    expect(api.save).not.toHaveBeenCalled()
  })

  it("saves a completed snapshot once across parent rerenders", async () => {
    const messages = [userMessage("user-1", "Create an accommodation")]
    const onPersist = vi.fn()
    api.save.mockResolvedValue(savedConversation(messages))

    const { rerender } = renderHook(
      ({ currentMessages, persist }) =>
        useConversationAutosave({
          tenantId: "tenant-1",
          conversationId: "conversation-1",
          initialMessages: [],
          messages: currentMessages,
          status: "ready",
          onPersist: persist,
          onError: vi.fn(),
        }),
      {
        initialProps: {
          currentMessages: messages,
          persist: onPersist,
        },
      },
    )

    await advanceAutosave()

    expect(api.save).toHaveBeenCalledTimes(1)
    expect(onPersist).toHaveBeenCalledTimes(1)

    rerender({
      currentMessages: [userMessage("user-1", "Create an accommodation")],
      persist: vi.fn(),
    })
    await advanceAutosave()

    expect(api.save).toHaveBeenCalledTimes(1)
  })

  it("waits for streaming to finish before saving", async () => {
    const messages = [userMessage("user-1", "List applications")]
    api.save.mockResolvedValue(savedConversation(messages))

    const { rerender } = renderHook(
      ({ status }) =>
        useConversationAutosave({
          tenantId: "tenant-1",
          conversationId: "conversation-1",
          initialMessages: [],
          messages,
          status,
          onPersist: vi.fn(),
          onError: vi.fn(),
        }),
      { initialProps: { status: "streaming" as const } },
    )

    await advanceAutosave()
    expect(api.save).not.toHaveBeenCalled()

    rerender({ status: "ready" })
    await advanceAutosave()

    expect(api.save).toHaveBeenCalledTimes(1)
  })

  it("serializes writes and keeps only the latest pending snapshot", async () => {
    const firstMessages = [userMessage("user-1", "First")]
    const secondMessages = [userMessage("user-1", "Second")]
    const latestMessages = [userMessage("user-1", "Latest")]
    let resolveFirst: ((value: StoredConversation) => void) | undefined
    const firstSave = new Promise<StoredConversation>((resolve) => {
      resolveFirst = resolve
    })
    api.save
      .mockReturnValueOnce(firstSave)
      .mockResolvedValue(savedConversation(latestMessages))

    const { rerender } = renderHook(
      ({ messages }) =>
        useConversationAutosave({
          tenantId: "tenant-1",
          conversationId: "conversation-1",
          initialMessages: [],
          messages,
          status: "ready",
          onPersist: vi.fn(),
          onError: vi.fn(),
        }),
      { initialProps: { messages: firstMessages } },
    )

    await advanceAutosave()
    expect(api.save).toHaveBeenCalledTimes(1)

    rerender({ messages: secondMessages })
    await advanceAutosave()
    rerender({ messages: latestMessages })
    await advanceAutosave()

    expect(api.save).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFirst?.(savedConversation(firstMessages))
      await firstSave
      await Promise.resolve()
    })

    expect(api.save).toHaveBeenCalledTimes(2)
    expect(JSON.stringify(api.save.mock.calls[1]?.[2])).toContain("Latest")
    expect(JSON.stringify(api.save.mock.calls[1]?.[2])).not.toContain("Second")
  })

  it("reports a failed snapshot only once", async () => {
    const messages = [userMessage("user-1", "Save this")]
    const updatedMessages = [userMessage("user-1", "Save this update")]
    const onError = vi.fn()
    api.save
      .mockRejectedValueOnce(new Error("Network error"))
      .mockResolvedValue(savedConversation(updatedMessages))

    const { rerender } = renderHook(
      ({ currentMessages }) =>
        useConversationAutosave({
          tenantId: "tenant-1",
          conversationId: "conversation-1",
          initialMessages: [],
          messages: currentMessages,
          status: "ready",
          onPersist: vi.fn(),
          onError,
        }),
      { initialProps: { currentMessages: messages } },
    )

    await advanceAutosave()
    expect(onError).toHaveBeenCalledTimes(1)

    rerender({ currentMessages: [userMessage("user-1", "Save this")] })
    await advanceAutosave()

    expect(api.save).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledTimes(1)

    rerender({ currentMessages: updatedMessages })
    await advanceAutosave()

    expect(api.save).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledTimes(1)
  })
})
