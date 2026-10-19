import { Download } from "lucide-react"
import { type ReactNode, useRef } from "react"
import { useTranslation } from "react-i18next"
import QRCodeReact from "react-qr-code"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { downloadQrPng } from "@/lib/qr-download"
import { formatRelative } from "@/lib/relativeTime"

const QRcode = ({
  check_in_code,
  isOpen,
  onOpenChange,
  lastScanAt,
  children,
  title = "Check-in Code",
  description = "Use this code to check in",
}: {
  check_in_code: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  children?: ReactNode
  lastScanAt?: string | null
  title?: string
  description?: string
}) => {
  const { t, i18n } = useTranslation()
  const qrCodeRef = useRef<HTMLDivElement>(null)
  const qrValue = JSON.stringify({ code: check_in_code })

  const handleDownload = () => {
    downloadQrPng(
      qrCodeRef.current,
      `check-in-code-${check_in_code}.png`,
    ).catch(() => {
      // The code is on screen and can be shown directly; a failed save is
      // not worth interrupting someone at a door over.
    })
  }

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {/* Inset from the screen edges on phones, where the base dialog is
          full width and square. */}
      <DialogContent className="max-h-[85dvh] overflow-y-auto w-[calc(100%-2rem)] max-w-sm gap-3 rounded-2xl bg-card p-5 sm:max-w-md sm:gap-4 sm:p-6">
        <DialogHeader className="px-6">
          <DialogTitle className="text-base leading-snug sm:text-lg">
            {title}
          </DialogTitle>
        </DialogHeader>
        {lastScanAt ? (
          <div className="flex items-center gap-2 rounded-md bg-yellow-50 px-3 py-2 text-sm text-yellow-700">
            <span className="h-2 w-2 rounded-full bg-yellow-500" />
            <span>
              {t("passes.qr_already_scanned")} ·{" "}
              {formatRelative(lastScanAt, i18n.language)}
            </span>
          </div>
        ) : null}
        <div className="flex flex-col items-center justify-center py-1 sm:py-4">
          {check_in_code ? (
            <div className="flex w-full flex-col items-center gap-3 sm:gap-4">
              {/* Scaled by CSS only: the PNG download sizes its own copy. */}
              <div
                ref={qrCodeRef}
                className="w-full max-w-[220px] rounded-xl border border-border bg-white p-3 sm:max-w-[232px] sm:p-4 [&>svg]:h-auto [&>svg]:w-full"
              >
                <QRCodeReact value={qrValue} size={200} level="H" />
              </div>
              <div className="space-y-1 text-center sm:space-y-2">
                <p className="font-mono text-base tracking-wider sm:text-lg">
                  {check_in_code}
                </p>
                <DialogDescription className="text-sm text-pass-text">
                  {description}
                </DialogDescription>
              </div>
              <Button
                onClick={handleDownload}
                className="flex w-full items-center gap-2 sm:w-auto"
                variant="outline"
                aria-label="Download QR code"
              >
                <Download className="h-4 w-4" />
                <span>Download QR</span>
              </Button>
            </div>
          ) : (
            <p className="text-lg text-pass-text text-center">
              No code available
            </p>
          )}
        </div>
        {children}
      </DialogContent>
    </Dialog>
  )
}

export default QRcode
