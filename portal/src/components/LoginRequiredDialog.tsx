"use client"

import { useRouter } from "next/navigation"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export interface LoginRequiredEvent {
  id: string
  title: string
  start_time: string
  occurrence_id?: string | null
}

interface LoginRequiredDialogProps {
  event: LoginRequiredEvent | null
  popupSlug: string
  popupName?: string
  onClose: () => void
}

/**
 * Modal shown when an anonymous visitor on the public calendar clicks an
 * event. Offers to send them to the auth flow with a ``?redirect=`` back
 * to the event detail page they wanted to see.
 */
export function LoginRequiredDialog({
  event,
  popupSlug,
  popupName,
  onClose,
}: LoginRequiredDialogProps) {
  const { t } = useTranslation()
  const router = useRouter()

  const handleLogin = () => {
    if (!event) return
    let redirect = `/portal/${popupSlug}/events/${event.id}`
    if (event.occurrence_id) {
      redirect += `?occ=${encodeURIComponent(event.start_time)}`
    }
    router.push(`/auth?redirect=${encodeURIComponent(redirect)}`)
  }

  return (
    <Dialog
      open={event !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("events.login_required.title")}</DialogTitle>
          <DialogDescription>
            {t("events.login_required.message", {
              popupName: popupName ?? "",
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>
            {t("events.login_required.cancel")}
          </Button>
          <Button onClick={handleLogin}>
            {t("events.login_required.login")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
