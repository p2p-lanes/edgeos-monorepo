import { Sparkles } from "lucide-react"
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

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={aiTranslate.isPending}
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
      <Sparkles className="mr-2 h-4 w-4" />
      {aiTranslate.isPending ? "Translating..." : "AI Translate"}
    </Button>
  )
}
