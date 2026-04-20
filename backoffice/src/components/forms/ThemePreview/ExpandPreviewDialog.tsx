import type { ReactNode } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { NATIVE_HEIGHT, NATIVE_WIDTH, TAB_LABELS } from "./constants"
import type { PreviewTab } from "./types"

interface ExpandPreviewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  activeTab: PreviewTab
  cssVars: Record<string, string>
  fontBaseSize: string
  children: ReactNode
}

// Renders the active preview tab at native (unscaled) resolution inside a
// modal so the admin can inspect details without the 0.5x zoom.
export function ExpandPreviewDialog({
  open,
  onOpenChange,
  activeTab,
  cssVars,
  fontBaseSize,
  children,
}: ExpandPreviewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[min(calc(100vw-2rem),820px)] max-h-[calc(100vh-4rem)] overflow-hidden p-0 sm:max-w-[820px]"
        showCloseButton
      >
        <DialogTitle className="px-6 pt-6 pb-2">
          Preview — {TAB_LABELS[activeTab]}
        </DialogTitle>
        <div className="overflow-auto px-6 pb-6">
          <div
            style={{
              width: NATIVE_WIDTH,
              height: NATIVE_HEIGHT,
              ...(cssVars as React.CSSProperties),
              backgroundColor: "var(--background)",
              color: "var(--body)",
              fontFamily: "system-ui, sans-serif",
              fontSize: fontBaseSize || "16px",
            }}
          >
            {children}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
