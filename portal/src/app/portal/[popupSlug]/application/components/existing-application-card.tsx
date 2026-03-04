import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { ApplicationPublic, PopupPublic } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useCityProvider } from "@/providers/cityProvider"

interface ExistingApplicationCardProps {
  onImport: () => void
  onCancel: () => void
  data: ApplicationPublic
}

export function ExistingApplicationCard({
  onImport,
  onCancel,
  data,
}: ExistingApplicationCardProps) {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(true)
  const { getPopups } = useCityProvider()
  const popups = getPopups()

  const handleImport = () => {
    onImport()
    setIsOpen(false)
  }

  const handleCancel = () => {
    onCancel()
    setIsOpen(false)
  }

  const popup = popups.find((popup: PopupPublic) => popup.id === data.popup_id)

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogContent
        className="sm:max-w-[425px] bg-white"
        onPointerDownOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{t("application.existing_found")}</DialogTitle>
          <DialogDescription>
            {t("application.existing_description")}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          {/* LEGACY: first_name, last_name, email no longer in ApplicationPublic */}
          {data.human && (
            <p>
              <strong>{t("application.applicant")}</strong>{" "}
              {data.human.first_name} {data.human.last_name}
            </p>
          )}
          {data.human?.email && (
            <p>
              <strong>{t("application.email")}</strong> {data.human.email}
            </p>
          )}
          <p>
            <strong>{t("application.popup_city")}</strong> {popup?.name}
          </p>
        </div>
        <p className="mt-4">{t("application.import_prompt")}</p>
        <DialogFooter className="flex flex-col gap-4 md:flex-row">
          <Button variant="outline" onClick={handleCancel}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleImport}>
            {t("application.import_button")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
