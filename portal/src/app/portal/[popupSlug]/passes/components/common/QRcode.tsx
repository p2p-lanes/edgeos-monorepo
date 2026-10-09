import { Download } from "lucide-react"
import { useRef } from "react"
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
  title = "Check-in Code",
  description = "Use this code to check in",
}: {
  check_in_code: string
  isOpen: boolean
  onOpenChange: (open: boolean) => void
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
      <DialogContent className="sm:max-w-md bg-card">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
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
        <div className="flex flex-col items-center justify-center py-4">
          {check_in_code ? (
            <div className="flex flex-col items-center gap-4">
              <div
                ref={qrCodeRef}
                className="bg-white p-4 rounded-md border border-border"
              >
                <QRCodeReact value={qrValue} size={200} level="H" />
              </div>
              <div className="text-center space-y-2">
                <p className="text-lg font-mono">{check_in_code}</p>
                <DialogDescription className="text-sm text-pass-text">
                  {description}
                </DialogDescription>
              </div>
              <Button
                onClick={handleDownload}
                className="flex items-center gap-2"
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
      </DialogContent>
    </Dialog>
  )
}

export default QRcode
