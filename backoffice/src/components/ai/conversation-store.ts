import type { UIMessage } from "ai"
import {
  type AIConversationPublic,
  type AIConversationUsageSummary,
  AiConversationsService,
} from "@/client"

export type StoredConversation = {
  id: string
  title: string
  updatedAt: string
  expiresAt: string
  revision: number
  messages: UIMessage[]
  usage: AIConversationUsageSummary
}

const ACTIVE_STORAGE_KEY = "edgeos-ai-active-conversation-v1"
const LEGACY_STORAGE_KEY = "edgeos-ai-conversations-v1"
const MAX_MESSAGES = 40

type ActiveConversationStore = Record<string, string>

function activeStore(): ActiveConversationStore {
  if (typeof window === "undefined") return {}
  try {
    const value = JSON.parse(localStorage.getItem(ACTIVE_STORAGE_KEY) ?? "{}")
    return typeof value === "object" && value !== null
      ? (value as ActiveConversationStore)
      : {}
  } catch {
    return {}
  }
}

export function conversationContextKey(
  userId: string | undefined,
  tenantId: string | null,
) {
  return `${userId ?? "loading"}:${tenantId ?? "none"}`
}

export function activeConversationId(contextKey: string) {
  return activeStore()[contextKey]
}

export function setActiveConversation(contextKey: string, id: string) {
  if (typeof window === "undefined") return
  const store = activeStore()
  store[contextKey] = id
  localStorage.setItem(ACTIVE_STORAGE_KEY, JSON.stringify(store))
}

export function clearLegacyConversationStorage() {
  if (typeof window === "undefined") return
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}

function compactMessages(messages: UIMessage[]) {
  return messages.slice(-MAX_MESSAGES).map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (!part.type.startsWith("tool-")) return part
      if (
        "state" in part &&
        (part.state === "approval-requested" ||
          part.state === "approval-responded")
      ) {
        return {
          ...part,
          state: "output-denied",
          approval: {
            ...part.approval,
            approved: false,
            signature: undefined,
          },
        }
      }
      if (!("output" in part)) return part
      const output = part.output
      if (typeof output !== "object" || output === null) return part
      const record = output as Record<string, unknown>
      if (part.type === "tool-prepareCustomExport") {
        return {
          type: "data-expired-prepared-file",
          data: {
            persistedState: "expired",
            kind: "custom-export",
          },
        }
      }
      if (
        part.type === "tool-executeOperation" &&
        typeof record.download === "object" &&
        record.download !== null
      ) {
        return {
          type: "data-expired-prepared-file",
          data: {
            persistedState: "expired",
            kind: "download",
          },
        }
      }
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

function storedConversation(value: AIConversationPublic): StoredConversation {
  return {
    id: value.id,
    title: value.title,
    updatedAt: value.updated_at,
    expiresAt: value.expires_at,
    revision: value.revision,
    messages: value.messages as unknown as UIMessage[],
    usage: value.usage ?? {},
  }
}

export function createConversationId() {
  return crypto.randomUUID()
}

export async function loadConversations(tenantId: string | null) {
  if (!tenantId) return []
  const conversations = await AiConversationsService.listAiConversations({
    xTenantId: tenantId,
  })
  return conversations.map(storedConversation)
}

export async function saveConversation(
  tenantId: string | null,
  id: string,
  messages: UIMessage[],
) {
  if (!tenantId || !messages.length) return undefined
  const conversation = await AiConversationsService.upsertAiConversation({
    conversationId: id,
    xTenantId: tenantId,
    requestBody: {
      messages: compactMessages(messages) as unknown as Array<
        Record<string, unknown>
      >,
    },
  })
  return storedConversation(conversation)
}

export async function removeConversation(tenantId: string | null, id: string) {
  if (!tenantId) return
  await AiConversationsService.deleteAiConversation({
    conversationId: id,
    xTenantId: tenantId,
  })
}

export { compactMessages }
