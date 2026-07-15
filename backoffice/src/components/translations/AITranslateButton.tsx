import { Loader2, Sparkles } from "lucide-react"
import { Button } from "@/components/ui/button"
import useCustomToast from "@/hooks/useCustomToast"
import { useAITranslate } from "@/hooks/useTranslations"

interface AITranslateButtonProps {
  entityType: string
  entityId: string
  targetLanguage: string
  onTranslated: (data: Record<string, string>) => void
}

export function AITranslateButton({
  entityType,
  entityId,
  targetLanguage,
  onTranslated,
}: AITranslateButtonProps) {
  const aiTranslate = useAITranslate()
  const { showErrorToast } = useCustomToast()
  const isPending = aiTranslate.isPending

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending}
        onClick={() => {
          aiTranslate.mutate(
            {
              entity_type: entityType,
              entity_id: entityId,
              target_language: targetLanguage,
            },
            {
              onSuccess: (data) => onTranslated(data),
              onError: (err) =>
                showErrorToast(
                  err instanceof Error ? err.message : "AI translation failed",
                ),
            },
          )
        }}
      >
        {isPending ? (
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="mr-2 h-4 w-4" />
        )}
        {isPending ? "Translating..." : "AI Translate"}
      </Button>
      {isPending && (
        <span
          aria-live="polite"
          className="text-xs text-muted-foreground animate-pulse"
        >
          Translating with AI, this can take a few seconds. Please keep this
          page open.
        </span>
      )}
    </div>
  )
}
