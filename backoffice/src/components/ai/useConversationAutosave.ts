import type { ChatStatus, UIMessage } from "ai"
import { useCallback, useEffect, useMemo, useRef } from "react"
import {
  compactMessages,
  type StoredConversation,
  saveConversation,
} from "./conversation-store"

const AUTOSAVE_DELAY_MS = 400

type SaveCandidate = {
  messages: UIMessage[]
  snapshot: string
}

type ConversationAutosaveOptions = {
  tenantId: string | null
  conversationId: string
  initialMessages: UIMessage[]
  messages: UIMessage[]
  status: ChatStatus
  onPersist: (conversation: StoredConversation) => void
  onError: (error: unknown) => void
}

function saveCandidate(messages: UIMessage[]): SaveCandidate | null {
  if (!messages.length) return null
  const compacted = compactMessages(messages)
  return {
    // saveConversation performs the actual compaction before upload.
    messages,
    snapshot: JSON.stringify(compacted),
  }
}

export function useConversationAutosave({
  tenantId,
  conversationId,
  initialMessages,
  messages,
  status,
  onPersist,
  onError,
}: ConversationAutosaveOptions) {
  const initialSnapshot = useRef(
    saveCandidate(initialMessages)?.snapshot ?? null,
  )
  const lastSavedSnapshot = useRef(initialSnapshot.current)
  const failedSnapshot = useRef<string | null>(null)
  const pendingSave = useRef<SaveCandidate | null>(null)
  const saving = useRef(false)
  const mounted = useRef(false)
  const onPersistRef = useRef(onPersist)
  const onErrorRef = useRef(onError)
  const candidate = useMemo(() => saveCandidate(messages), [messages])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      pendingSave.current = null
    }
  }, [])

  useEffect(() => {
    onPersistRef.current = onPersist
    onErrorRef.current = onError
  }, [onError, onPersist])

  const flushPendingSave = useCallback(async () => {
    if (saving.current) return
    saving.current = true

    try {
      while (pendingSave.current) {
        const current = pendingSave.current
        pendingSave.current = null
        if (
          current.snapshot === lastSavedSnapshot.current ||
          current.snapshot === failedSnapshot.current
        ) {
          continue
        }

        let conversation: StoredConversation | undefined
        try {
          conversation = await saveConversation(
            tenantId,
            conversationId,
            current.messages,
          )
        } catch (error) {
          failedSnapshot.current = current.snapshot
          if (mounted.current) onErrorRef.current(error)
          continue
        }

        lastSavedSnapshot.current = current.snapshot
        failedSnapshot.current = null
        if (mounted.current && conversation) {
          onPersistRef.current(conversation)
        }
      }
    } finally {
      saving.current = false
    }
  }, [conversationId, tenantId])

  useEffect(() => {
    if (
      !tenantId ||
      !candidate ||
      status === "submitted" ||
      status === "streaming" ||
      candidate.snapshot === lastSavedSnapshot.current ||
      candidate.snapshot === failedSnapshot.current
    ) {
      return
    }

    const timer = window.setTimeout(() => {
      pendingSave.current = candidate
      void flushPendingSave()
    }, AUTOSAVE_DELAY_MS)

    return () => window.clearTimeout(timer)
  }, [candidate, flushPendingSave, status, tenantId])
}
