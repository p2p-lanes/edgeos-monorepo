import type { UIMessage } from "ai"

export type StoredConversation = {
  id: string
  title: string
  updatedAt: string
  messages: UIMessage[]
}

type ContextConversations = {
  activeId?: string
  conversations: StoredConversation[]
}

type ConversationStore = Record<string, ContextConversations>

const STORAGE_KEY = "edgeos-ai-conversations-v1"
const MAX_CONVERSATIONS = 8
const MAX_MESSAGES = 40

export function conversationContextKey(
  userId: string | undefined,
  tenantId: string | null,
  popupId: string | null,
) {
  return `${userId ?? "loading"}:${tenantId ?? "none"}:${popupId ?? "none"}`
}

function readStore(): ConversationStore {
  if (typeof window === "undefined") return {}
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}")
    return typeof value === "object" && value !== null
      ? (value as ConversationStore)
      : {}
  } catch {
    return {}
  }
}

function writeStore(store: ConversationStore) {
  if (typeof window === "undefined") return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    // Conversations are a convenience cache. A full storage quota must never
    // interrupt the active chat.
  }
}

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .trim()
}

function titleFor(messages: UIMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user")
  const text = firstUserMessage
    ? messageText(firstUserMessage)
    : "New conversation"
  return text.length > 58 ? `${text.slice(0, 57).trim()}…` : text
}

function compactMessages(messages: UIMessage[]) {
  return messages.slice(-MAX_MESSAGES).map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (!part.type.startsWith("tool-")) return part
      if ("state" in part && part.state === "approval-requested") {
        return {
          ...part,
          state: "output-denied",
          approval: {
            ...part.approval,
            approved: false,
          },
        }
      }
      if (!("output" in part)) return part
      const output = part.output
      if (typeof output !== "object" || output === null) return part
      const record = output as Record<string, unknown>
      if (part.type === "tool-searchOperations") {
        const count = Array.isArray(record.operations)
          ? record.operations.length
          : record.operation
            ? 1
            : 0
        return {
          ...part,
          output: { resultCount: count },
        }
      }
      return {
        ...part,
        output: {
          operation: record.operation,
          status: record.status,
          requestId: record.requestId,
          context: record.context,
          data: record.data ? { persistedSummary: true } : undefined,
        },
      }
    }),
  })) as UIMessage[]
}

export function createConversationId() {
  return `conversation-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function loadConversations(contextKey: string) {
  return readStore()[contextKey]?.conversations ?? []
}

export function loadActiveConversation(contextKey: string) {
  const context = readStore()[contextKey]
  if (!context) return undefined
  return (
    context.conversations.find((item) => item.id === context.activeId) ??
    context.conversations[0]
  )
}

export function setActiveConversation(contextKey: string, id: string) {
  const store = readStore()
  const context = store[contextKey] ?? { conversations: [] }
  store[contextKey] = { ...context, activeId: id }
  writeStore(store)
}

export function saveConversation(
  contextKey: string,
  id: string,
  messages: UIMessage[],
) {
  if (!messages.length) return loadConversations(contextKey)
  const store = readStore()
  const context = store[contextKey] ?? { conversations: [] }
  const conversation: StoredConversation = {
    id,
    title: titleFor(messages),
    updatedAt: new Date().toISOString(),
    messages: compactMessages(messages),
  }
  const conversations = [
    conversation,
    ...context.conversations.filter((item) => item.id !== id),
  ]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, MAX_CONVERSATIONS)
  store[contextKey] = { activeId: id, conversations }
  writeStore(store)
  return conversations
}

export function removeConversation(contextKey: string, id: string) {
  const store = readStore()
  const context = store[contextKey]
  if (!context) return []
  const conversations = context.conversations.filter((item) => item.id !== id)
  store[contextKey] = {
    activeId: context.activeId === id ? conversations[0]?.id : context.activeId,
    conversations,
  }
  writeStore(store)
  return conversations
}
