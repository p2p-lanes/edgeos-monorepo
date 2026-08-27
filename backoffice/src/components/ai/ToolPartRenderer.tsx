import type { UIMessage } from "ai"
import { Check, Copy, RotateCcw, ThumbsDown, ThumbsUp } from "lucide-react"
import { useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { ActivitySummary, isBackgroundToolPart } from "./ActivitySummary"
import { BusinessResultTool, parseBusinessResults } from "./BusinessResultTool"
import { CustomExportTool } from "./CustomExportTool"
import { OperationExecutionTool } from "./OperationExecutionTool"
import type { GenericToolPart } from "./tool-types"

function AssistantText({ text }: { text: string }) {
  return (
    <div className="space-y-2 text-sm leading-6 text-foreground [&_a]:text-primary [&_a]:underline [&_li]:ml-4 [&_li]:list-disc [&_ol_li]:list-decimal [&_p]:my-1.5 [&_strong]:font-semibold">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

function MessageActions({
  messageId,
  text,
  onRegenerate,
}: {
  messageId: string
  text: string
  onRegenerate?: () => void
}) {
  const [copied, setCopied] = useState(false)
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Could not copy this response")
    }
  }

  const submitFeedback = async (rating: "up" | "down") => {
    const next = feedback === rating ? null : rating
    setFeedback(next)
    if (!next) return
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${localStorage.getItem("access_token") ?? ""}`,
        "Content-Type": "application/json",
      }
      const tenantId = localStorage.getItem("workspace_tenant_id")
      const popupId = localStorage.getItem("workspace_popup_id")
      if (tenantId) headers["X-Tenant-Id"] = tenantId
      if (popupId) headers["X-Popup-Id"] = popupId
      const response = await fetch("/api/ai/feedback", {
        method: "POST",
        headers,
        body: JSON.stringify({ messageId, rating: next }),
      })
      if (!response.ok) throw new Error("Feedback request failed")
      toast.success("Feedback recorded")
    } catch {
      setFeedback(null)
      toast.error("Could not record feedback")
    }
  }

  return (
    <div className="flex items-center gap-0.5 pt-1 text-muted-foreground">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7"
        onClick={copy}
        aria-label="Copy response"
      >
        {copied ? <Check className="text-success" /> : <Copy />}
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7"
        aria-label="Helpful response"
        aria-pressed={feedback === "up"}
        onClick={() => submitFeedback("up")}
      >
        <ThumbsUp className={feedback === "up" ? "text-primary" : undefined} />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="size-7"
        aria-label="Unhelpful response"
        aria-pressed={feedback === "down"}
        onClick={() => submitFeedback("down")}
      >
        <ThumbsDown
          className={feedback === "down" ? "text-destructive" : undefined}
        />
      </Button>
      {onRegenerate && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-7"
          onClick={onRegenerate}
          aria-label="Regenerate response"
        >
          <RotateCcw />
        </Button>
      )}
    </div>
  )
}

export function MessageParts({
  message,
  onApproval,
  onNavigate,
  isStreaming = false,
  onRegenerate,
}: {
  message: UIMessage
  onApproval: (id: string, approved: boolean) => void
  onNavigate: () => void
  isStreaming?: boolean
  onRegenerate?: () => void
}) {
  if (message.role === "user") {
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("")
    return (
      <div className="ml-10 rounded-xl rounded-br-sm bg-primary px-4 py-3 text-sm leading-6 text-primary-foreground">
        {text}
      </div>
    )
  }

  const parts = message.parts as GenericToolPart[]
  const businessResults = new Map(
    parts.flatMap((part, index) => {
      const results = parseBusinessResults(part)
      return results ? [[index, results] as const] : []
    }),
  )
  const backgroundParts = parts.filter(
    (part, index) =>
      part.type.startsWith("tool-") &&
      !businessResults.has(index) &&
      isBackgroundToolPart(part),
  )
  const firstBackgroundPart = parts.findIndex(
    (part, index) =>
      part.type.startsWith("tool-") &&
      !businessResults.has(index) &&
      isBackgroundToolPart(part),
  )
  const text = parts
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join("\n")

  return (
    <div className="space-y-3 border-l border-primary/30 pl-4">
      {parts.map((part, index) => {
        if (part.type === "text" && part.text) {
          return (
            <AssistantText
              key={`${message.id}-text-${index}`}
              text={part.text}
            />
          )
        }
        if (!part.type.startsWith("tool-")) return null
        const results = businessResults.get(index)
        if (results) {
          return (
            <BusinessResultTool
              key={part.toolCallId ?? `${part.type}-${index}`}
              results={results}
              onNavigate={onNavigate}
            />
          )
        }
        if (isBackgroundToolPart(part)) {
          return index === firstBackgroundPart ? (
            <ActivitySummary
              key={`${message.id}-activity`}
              parts={backgroundParts}
              streaming={isStreaming}
            />
          ) : null
        }
        if (part.type === "tool-prepareCustomExport") {
          return (
            <CustomExportTool
              key={part.toolCallId ?? `${part.type}-${index}`}
              part={part}
              onApproval={onApproval}
              onNavigate={onNavigate}
            />
          )
        }
        if (part.type !== "tool-executeOperation") return null
        return (
          <OperationExecutionTool
            key={part.toolCallId ?? `${part.type}-${index}`}
            part={part}
            onApproval={onApproval}
            onNavigate={onNavigate}
          />
        )
      })}
      {text && !isStreaming && (
        <MessageActions
          messageId={message.id}
          text={text}
          onRegenerate={onRegenerate}
        />
      )}
    </div>
  )
}
