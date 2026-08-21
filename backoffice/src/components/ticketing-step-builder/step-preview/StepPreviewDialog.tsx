import { useMutation } from "@tanstack/react-query"
import { Loader2, Monitor, RefreshCw, Smartphone } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"

import { PopupsService, type TicketingStepPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useCurrentTenant } from "@/hooks/useCurrentTenant"
import { cn } from "@/lib/utils"
import { previewOrigin, resolvePreviewTarget } from "./previewUrl"
import { useStepPreviewBridge } from "./useStepPreviewBridge"

type Viewport = "desktop" | "mobile"

interface StepPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  popupId: string
  popupSlug: string | null | undefined
  supportedLanguages: string[]
  defaultLanguage: string | null | undefined
  /** The step open in the editor, unsaved changes included. Null when no step
   *  is being edited — the preview then shows the saved checkout. */
  step: TicketingStepPublic | null
}

/**
 * Live preview of the checkout, rendered by the portal itself.
 *
 * The dialog embeds the real checkout page, which opens on the first available
 * step exactly as it would for a buyer — same shell, skin, theme and product
 * components. When a step is open in the editor its draft is posted in too, so
 * unsaved changes show up without saving first.
 */
export function StepPreviewDialog({
  open,
  onOpenChange,
  popupId,
  popupSlug,
  supportedLanguages,
  defaultLanguage,
  step,
}: StepPreviewDialogProps) {
  const { data: tenant, isLoading: isTenantLoading } = useCurrentTenant()
  const [viewport, setViewport] = useState<Viewport>("desktop")
  const [language, setLanguage] = useState<string | null>(
    defaultLanguage ?? null,
  )
  // Bumped to force a fresh iframe document (reload, language switch).
  const [frameKey, setFrameKey] = useState(0)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const target = resolvePreviewTarget(tenant, popupSlug, language)
  const url = target.url
  const origin = url ? previewOrigin(url) : null

  // A mutation rather than a query: minting a token is a POST, and it should
  // happen when the preview opens (and when a long session outlives the
  // token), not on react-query's cache schedule.
  const tokenMutation = useMutation({
    mutationFn: () =>
      PopupsService.createCheckoutPreviewToken({ popupId }).then(
        (r) => r.token,
      ),
  })
  const mintToken = tokenMutation.mutate
  const previewToken = tokenMutation.data ?? null

  useEffect(() => {
    if (!open || !url) return
    mintToken()
  }, [open, url, mintToken])

  const { reset } = useStepPreviewBridge({
    iframeRef,
    targetOrigin: origin,
    previewToken,
    step,
  })

  const reload = useCallback(() => {
    reset()
    setFrameKey((key) => key + 1)
    // The token outlives a reload, but re-minting keeps a long editing session
    // from hitting its expiry mid-preview.
    mintToken()
  }, [reset, mintToken])

  const changeLanguage = useCallback(
    (next: string) => {
      setLanguage(next)
      reset()
      setFrameKey((key) => key + 1)
    },
    [reset],
  )

  const hasLanguages = supportedLanguages.length > 1

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[calc(100vh-3rem)] w-[calc(100vw-3rem)] max-w-none flex-col gap-3 p-4 sm:max-w-none"
        showCloseButton
      >
        <div className="flex flex-wrap items-center gap-2 pr-8">
          <div>
            <DialogTitle className="text-base">Checkout preview</DialogTitle>
            <DialogDescription className="text-xs">
              {step
                ? "The live checkout, including this step's unsaved changes."
                : "The live checkout, exactly as a buyer sees it."}
            </DialogDescription>
          </div>

          <div className="flex-1" />

          {hasLanguages && (
            <Select
              value={language ?? undefined}
              onValueChange={changeLanguage}
            >
              <SelectTrigger className="h-8 w-24" aria-label="Preview language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {supportedLanguages.map((lang) => (
                  <SelectItem key={lang} value={lang}>
                    {lang.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <div className="flex items-center gap-1 rounded-md border p-0.5">
            <Button
              type="button"
              variant={viewport === "desktop" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => setViewport("desktop")}
              aria-label="Desktop preview"
              aria-pressed={viewport === "desktop"}
            >
              <Monitor className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant={viewport === "mobile" ? "secondary" : "ghost"}
              size="icon"
              className="h-7 w-7"
              onClick={() => setViewport("mobile")}
              aria-label="Mobile preview"
              aria-pressed={viewport === "mobile"}
            >
              <Smartphone className="h-4 w-4" />
            </Button>
          </div>

          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8"
            onClick={reload}
            disabled={!url}
            aria-label="Reload preview"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded-lg border bg-muted/30 p-3">
          {isTenantLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : !url ? (
            <p className="max-w-md text-center text-sm text-muted-foreground">
              {target.reason}
            </p>
          ) : tokenMutation.isError ? (
            <div className="flex flex-col items-center gap-3 text-center">
              <p className="max-w-md text-sm text-muted-foreground">
                Could not authorize the preview for this event.
              </p>
              <Button variant="outline" size="sm" onClick={reload}>
                Try again
              </Button>
            </div>
          ) : (
            <iframe
              key={frameKey}
              ref={iframeRef}
              src={url}
              title="Checkout preview"
              className={cn(
                "h-full border-0 bg-background shadow-sm",
                viewport === "mobile"
                  ? "w-[390px] max-w-full rounded-[1.5rem] border-8 border-foreground/80"
                  : "w-full rounded-md",
              )}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
