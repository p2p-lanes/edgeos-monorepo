import { useChat } from "@ai-sdk/react"
import { useQuery } from "@tanstack/react-query"
import { useRouterState } from "@tanstack/react-router"
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from "ai"
import {
  ArrowDown,
  ArrowUp,
  Check,
  CircleStop,
  Clock3,
  History,
  Loader2,
  MessageSquareText,
  Minus,
  Plus,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react"
import {
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { toast } from "sonner"
import { PopupsService, TenantsService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import { cn } from "@/lib/utils"
import { assistantContextForPath } from "./assistant-context"
import {
  conversationContextKey,
  createConversationId,
  loadActiveConversation,
  loadConversations,
  type StoredConversation,
  saveConversation,
  setActiveConversation,
} from "./conversation-store"
import { MessageParts } from "./ToolPartRenderer"

const MIN_PANEL_WIDTH = 360
const MAX_PANEL_WIDTH = 680
const DEFAULT_PANEL_WIDTH = 480
const PANEL_WIDTH_KEY = "edgeos-ai-panel-width"

type AssistantChat = ReturnType<typeof useChat>

function useDesktopPanel() {
  const [desktop, setDesktop] = useState(() =>
    typeof window === "undefined"
      ? true
      : window.matchMedia("(min-width: 1024px)").matches,
  )

  useEffect(() => {
    const query = window.matchMedia("(min-width: 1024px)")
    const update = () => setDesktop(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  return desktop
}

function safePanelWidth() {
  if (typeof window === "undefined") return DEFAULT_PANEL_WIDTH
  const stored = Number(localStorage.getItem(PANEL_WIDTH_KEY))
  return Number.isFinite(stored)
    ? Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, stored))
    : DEFAULT_PANEL_WIDTH
}

function formatConversationTime(value: string) {
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
    }).format(date)
  }
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(date)
}

function AssistantSession({
  popupId,
  chat,
  suggestions,
  placeholder,
  onNavigate,
  onRequestNew,
  onMessageStateChange,
}: {
  popupId: string | null
  chat: AssistantChat
  suggestions: string[]
  placeholder: string
  onNavigate: () => void
  onRequestNew: () => void
  onMessageStateChange: (hasMessages: boolean) => void
}) {
  const [input, setInput] = useState("")
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const pinnedToBottom = useRef(true)
  const {
    messages,
    sendMessage,
    regenerate,
    status,
    stop,
    error,
    clearError,
    addToolApprovalResponse,
  } = chat

  const busy = status === "submitted" || status === "streaming"
  const latestMessage = messages[messages.length - 1]

  useEffect(() => {
    onMessageStateChange(messages.length > 0)
  }, [messages.length, onMessageStateChange])

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  useEffect(() => {
    const container = scrollRef.current
    if (!container || !pinnedToBottom.current || !latestMessage) return
    container.scrollTo({
      top: container.scrollHeight,
      behavior: status === "streaming" ? "auto" : "smooth",
    })
  }, [latestMessage, status])

  const handleScroll = () => {
    const container = scrollRef.current
    if (!container) return
    const nearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 80
    pinnedToBottom.current = nearBottom
    setShowJumpToLatest(!nearBottom)
  }

  const jumpToLatest = () => {
    const container = scrollRef.current
    if (!container) return
    pinnedToBottom.current = true
    setShowJumpToLatest(false)
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" })
  }

  const submit = (event?: FormEvent) => {
    event?.preventDefault()
    const text = input.trim()
    if (!text || busy) return
    clearError()
    setInput("")
    pinnedToBottom.current = true
    sendMessage({ text })
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      submit()
    }
  }

  const retry = () => {
    clearError()
    pinnedToBottom.current = true
    regenerate()
  }

  const sendSuggestion = (suggestion: string) => {
    clearError()
    pinnedToBottom.current = true
    sendMessage({ text: suggestion })
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="thin-scrollbar flex-1 overflow-y-auto px-4 py-5 sm:px-5"
      >
        {messages.length === 0 ? (
          <div className="flex min-h-full flex-col justify-between gap-10">
            <div className="pt-3">
              <div className="mb-5 flex size-11 items-center justify-center rounded-xl border border-primary/20 bg-primary/5 text-primary">
                <MessageSquareText className="size-5" />
              </div>
              <p className="font-display text-2xl font-semibold tracking-tight">
                What can I help you operate?
              </p>
              <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
                Ask about the current workspace, investigate live records, or
                prepare a change for your review.
              </p>
              {!popupId && (
                <div className="mt-4 rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm">
                  Select a gathering to work with gathering-specific records.
                </div>
              )}
            </div>
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">
                Suggested for this page
              </p>
              {suggestions.map((suggestion) => (
                <button
                  type="button"
                  key={suggestion}
                  onClick={() => sendSuggestion(suggestion)}
                  className="group flex w-full items-center justify-between rounded-lg border bg-card px-3.5 py-3 text-left text-sm transition-colors hover:border-primary/30 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {suggestion}
                  <ArrowUp className="size-3.5 rotate-45 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {messages.map((message, index) => {
              const latest = index === messages.length - 1
              return (
                <MessageParts
                  key={message.id}
                  message={message}
                  isStreaming={busy && latest}
                  onNavigate={onNavigate}
                  onRegenerate={
                    !busy && latest && message.role === "assistant"
                      ? () => regenerate({ messageId: message.id })
                      : undefined
                  }
                  onApproval={(id, approved) =>
                    addToolApprovalResponse({ id, approved })
                  }
                />
              )
            })}
            {status === "submitted" && (
              <output className="flex items-center gap-2 border-l border-primary/30 pl-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Understanding your request…
              </output>
            )}
            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive-soft p-3 text-sm">
                <p className="font-medium text-destructive">
                  The response could not be completed
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  {error.message || "The connection to the assistant failed."}
                </p>
                <div className="mt-3 flex gap-2">
                  <Button type="button" size="sm" onClick={retry}>
                    Try again
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearError}
                  >
                    Dismiss
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showJumpToLatest && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="absolute right-5 bottom-[118px] z-10 rounded-full bg-background shadow-md"
          onClick={jumpToLatest}
        >
          <ArrowDown /> Latest
        </Button>
      )}

      <div className="border-t bg-background/95 p-3 backdrop-blur sm:p-4">
        <form
          onSubmit={submit}
          className="rounded-xl border bg-card p-2 shadow-sm focus-within:border-primary/50 focus-within:ring-3 focus-within:ring-primary/10"
        >
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            aria-label={placeholder}
            className="max-h-32 min-h-10 resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-between px-1 pt-1">
            <span className="hidden text-[10px] text-muted-foreground sm:inline">
              Enter to send · Shift Enter for a new line
            </span>
            {busy ? (
              <Button
                type="button"
                size="icon-sm"
                variant="outline"
                className="ml-auto"
                onClick={stop}
              >
                <CircleStop />
                <span className="sr-only">Stop response</span>
              </Button>
            ) : (
              <Button
                type="submit"
                size="icon-sm"
                className="ml-auto"
                disabled={!input.trim()}
              >
                <ArrowUp />
                <span className="sr-only">Send message</span>
              </Button>
            )}
          </div>
        </form>
        <div className="mt-2 flex items-center justify-between px-1 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <ShieldCheck className="size-3" /> Changes always require your
            approval
          </span>
          {messages.length > 0 && (
            <button
              type="button"
              className="font-medium hover:text-foreground"
              disabled={busy}
              onClick={onRequestNew}
            >
              New conversation
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ConversationChat({
  contextKey,
  conversationId,
  initialMessages,
  pathname,
  effectiveTenantId,
  selectedPopupId,
  suggestions,
  placeholder,
  onNavigate,
  onRequestNew,
  onPersist,
  onMessageStateChange,
}: {
  contextKey: string
  conversationId: string
  initialMessages: UIMessage[]
  pathname: string
  effectiveTenantId: string | null
  selectedPopupId: string | null
  suggestions: string[]
  placeholder: string
  onNavigate: () => void
  onRequestNew: () => void
  onPersist: (conversations: StoredConversation[]) => void
  onMessageStateChange: (hasMessages: boolean) => void
}) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ai/chat",
        headers: () => {
          const headers: Record<string, string> = {
            Authorization: `Bearer ${localStorage.getItem("access_token") ?? ""}`,
            "X-EdgeOS-Pathname": pathname,
          }
          if (effectiveTenantId) headers["X-Tenant-Id"] = effectiveTenantId
          if (selectedPopupId) headers["X-Popup-Id"] = selectedPopupId
          return headers
        },
      }),
    [effectiveTenantId, pathname, selectedPopupId],
  )
  const chat = useChat({
    id: `${contextKey}:${conversationId}`,
    messages: initialMessages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  })

  useEffect(() => {
    if (!chat.messages.length) return
    const timer = window.setTimeout(() => {
      onPersist(saveConversation(contextKey, conversationId, chat.messages))
    }, 400)
    return () => window.clearTimeout(timer)
  }, [chat.messages, contextKey, conversationId, onPersist])

  return (
    <AssistantSession
      popupId={selectedPopupId}
      chat={chat}
      suggestions={suggestions}
      placeholder={placeholder}
      onNavigate={onNavigate}
      onRequestNew={onRequestNew}
      onMessageStateChange={onMessageStateChange}
    />
  )
}

function ConversationWorkspace({
  contextKey,
  pathname,
  effectiveTenantId,
  selectedPopupId,
  contextLabel,
  suggestions,
  placeholder,
  onNavigate,
}: {
  contextKey: string
  pathname: string
  effectiveTenantId: string | null
  selectedPopupId: string | null
  contextLabel: string
  suggestions: string[]
  placeholder: string
  onNavigate: () => void
}) {
  const active = useMemo(() => loadActiveConversation(contextKey), [contextKey])
  const [session, setSession] = useState(() => ({
    id: active?.id ?? createConversationId(),
    initialMessages: active?.messages ?? [],
  }))
  const conversationId = session.id
  const [conversations, setConversations] = useState(() =>
    loadConversations(contextKey),
  )
  const [hasMessages, setHasMessages] = useState(
    Boolean(active?.messages.length),
  )
  const [confirmNewOpen, setConfirmNewOpen] = useState(false)

  const startNewConversation = () => {
    const id = createConversationId()
    setActiveConversation(contextKey, id)
    setSession({ id, initialMessages: [] })
    setHasMessages(false)
    setConfirmNewOpen(false)
  }

  const requestNewConversation = () => {
    if (hasMessages) setConfirmNewOpen(true)
    else startNewConversation()
  }

  const openConversation = (conversation: StoredConversation) => {
    setActiveConversation(contextKey, conversation.id)
    setSession({
      id: conversation.id,
      initialMessages: conversation.messages,
    })
    setHasMessages(Boolean(conversation.messages.length))
  }

  return (
    <>
      <div className="flex min-h-11 items-center gap-2 border-b bg-muted/20 px-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium">{contextLabel}</p>
          <p className="text-[10px] text-muted-foreground">
            Conversation saved in this workspace
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Conversation history"
            >
              <History />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>Recent conversations</DropdownMenuLabel>
            {conversations.length ? (
              conversations.map((conversation) => (
                <DropdownMenuItem
                  key={conversation.id}
                  onSelect={() => openConversation(conversation)}
                  className="items-start py-2"
                >
                  {conversation.id === conversationId ? (
                    <Check className="mt-0.5 size-4 text-primary" />
                  ) : (
                    <Clock3 className="mt-0.5 size-4" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm">
                      {conversation.title}
                    </span>
                    <span className="block text-[10px] text-muted-foreground">
                      {formatConversationTime(conversation.updatedAt)}
                    </span>
                  </span>
                </DropdownMenuItem>
              ))
            ) : (
              <DropdownMenuItem disabled>
                No saved conversations yet
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={requestNewConversation}>
              <Plus /> New conversation
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="New conversation"
          onClick={requestNewConversation}
        >
          <Plus />
        </Button>
      </div>

      <ConversationChat
        key={conversationId}
        contextKey={contextKey}
        conversationId={conversationId}
        initialMessages={session.initialMessages}
        pathname={pathname}
        effectiveTenantId={effectiveTenantId}
        selectedPopupId={selectedPopupId}
        suggestions={suggestions}
        placeholder={placeholder}
        onNavigate={onNavigate}
        onRequestNew={requestNewConversation}
        onPersist={setConversations}
        onMessageStateChange={setHasMessages}
      />

      <Dialog open={confirmNewOpen} onOpenChange={setConfirmNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Start a new conversation?</DialogTitle>
            <DialogDescription>
              This conversation is already saved in {contextLabel}. You can
              reopen it later from history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmNewOpen(false)}>
              Keep current
            </Button>
            <Button onClick={startNewConversation}>Start new</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export function AIAssistant() {
  const [open, setOpen] = useState(false)
  const [panelWidth, setPanelWidth] = useState(safePanelWidth)
  const desktop = useDesktopPanel()
  const previousContext = useRef<string | null>(null)
  const wasOpen = useRef(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  const { isSuperadmin, user } = useAuth()
  const { selectedPopupId, selectedTenantId, effectiveTenantId } =
    useWorkspace()
  // Conversation history may contain PII or financial summaries. Scope it to
  // the authenticated user as well as the workspace so another user signing
  // into the same browser can never inherit the previous user's thread.
  const contextKey = conversationContextKey(
    user?.id,
    effectiveTenantId,
    selectedPopupId,
  )
  const pageContext = assistantContextForPath(pathname)

  const { data: tenants } = useQuery({
    queryKey: ["tenants"],
    queryFn: () => TenantsService.listTenants({ skip: 0, limit: 100 }),
    enabled: isSuperadmin && Boolean(selectedTenantId),
  })
  const { data: popups } = useQuery({
    queryKey: ["popups", effectiveTenantId],
    queryFn: () => PopupsService.listPopups({ skip: 0, limit: 100 }),
    enabled: Boolean(effectiveTenantId),
  })
  const tenantName = tenants?.results.find(
    (tenant) => tenant.id === selectedTenantId,
  )?.name
  const popupName = popups?.results.find(
    (popup) => popup.id === selectedPopupId,
  )?.name
  const contextLabel = [tenantName, popupName, pageContext.pageLabel]
    .filter(Boolean)
    .join(" › ")

  useEffect(() => {
    if (wasOpen.current && !open) {
      window.requestAnimationFrame(() => triggerRef.current?.focus())
    }
    wasOpen.current = open
  }, [open])

  useEffect(() => {
    if (
      previousContext.current &&
      previousContext.current !== contextKey &&
      open
    ) {
      toast.info("Assistant context changed", {
        description: `Now working in ${contextLabel}. Your previous conversation was saved.`,
      })
    }
    previousContext.current = contextKey
  }, [contextKey, contextLabel, open])

  useEffect(() => {
    if (!open) return
    const root = document.getElementById("root")
    if (!desktop && root) root.inert = true
    if (desktop) {
      document.body.dataset.aiPanelOpen = "true"
      document.documentElement.style.setProperty(
        "--ai-panel-width",
        `${panelWidth}px`,
      )
    }
    return () => {
      if (root) root.inert = false
      delete document.body.dataset.aiPanelOpen
      document.documentElement.style.removeProperty("--ai-panel-width")
    }
  }, [desktop, open, panelWidth])

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", closeOnEscape)
    return () => window.removeEventListener("keydown", closeOnEscape)
  }, [open])

  const resizeFromPointer = (event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = panelWidth
    let latestWidth = startWidth
    const move = (moveEvent: PointerEvent) => {
      const maximum = Math.min(MAX_PANEL_WIDTH, window.innerWidth - 320)
      latestWidth = Math.min(
        maximum,
        Math.max(MIN_PANEL_WIDTH, startWidth + startX - moveEvent.clientX),
      )
      setPanelWidth(latestWidth)
    }
    const finish = () => {
      localStorage.setItem(PANEL_WIDTH_KEY, String(latestWidth))
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", finish)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", finish)
  }

  const resizeFromKeyboard = (
    event: React.KeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return
    event.preventDefault()
    const delta = event.key === "ArrowLeft" ? 24 : -24
    const next = Math.min(
      MAX_PANEL_WIDTH,
      Math.max(MIN_PANEL_WIDTH, panelWidth + delta),
    )
    setPanelWidth(next)
    localStorage.setItem(PANEL_WIDTH_KEY, String(next))
  }

  const panel = open ? (
    <div
      role="dialog"
      aria-label="EdgeOS Assistant"
      aria-modal={!desktop}
      className={cn(
        "fixed inset-y-0 right-0 z-40 flex flex-col border-l bg-background shadow-2xl",
        desktop
          ? "animate-in slide-in-from-right duration-200 motion-reduce:animate-none"
          : "w-screen",
      )}
      style={desktop ? { width: panelWidth } : undefined}
    >
      {desktop && (
        <button
          type="button"
          aria-label="Resize assistant panel"
          className="group absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-col-resize touch-none focus-visible:outline-none"
          onPointerDown={resizeFromPointer}
          onKeyDown={resizeFromKeyboard}
        >
          <span className="absolute inset-y-0 left-1/2 w-px bg-border transition-colors group-hover:bg-primary group-focus-visible:bg-primary" />
        </button>
      )}
      <div className="flex min-h-16 items-center gap-3 border-b px-4">
        <div className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-display font-semibold tracking-tight">
            EdgeOS Assistant
          </h2>
          <p className="text-[10px] text-muted-foreground">
            Changes require approval
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => setOpen(false)}
          aria-label={desktop ? "Minimize assistant" : "Close assistant"}
        >
          {desktop ? <Minus /> : <X />}
        </Button>
      </div>
      <ConversationWorkspace
        key={contextKey}
        contextKey={contextKey}
        pathname={pathname}
        effectiveTenantId={effectiveTenantId}
        selectedPopupId={selectedPopupId}
        contextLabel={contextLabel || pageContext.pageLabel}
        suggestions={pageContext.suggestions}
        placeholder={pageContext.placeholder}
        onNavigate={() => {
          if (!desktop) setOpen(false)
        }}
      />
    </div>
  ) : null

  return (
    <>
      {!open && (
        <Button
          ref={triggerRef}
          variant="outline"
          size="sm"
          className="gap-2 bg-card"
          onClick={() => setOpen(true)}
          aria-label="Ask EdgeOS"
          aria-expanded={false}
          aria-controls="edgeos-assistant-panel"
        >
          <Sparkles className="text-primary" />
          <span className="hidden lg:inline">Ask EdgeOS</span>
        </Button>
      )}
      {typeof document !== "undefined" && panel
        ? createPortal(
            <div id="edgeos-assistant-panel" className="contents">
              {panel}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
