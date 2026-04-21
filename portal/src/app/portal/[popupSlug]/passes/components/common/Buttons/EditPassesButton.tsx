import { PencilIcon, XIcon } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { usePassesProvider } from "@/providers/passesProvider"

interface EditPassesButtonProps {
  onSwitchToBuy?: () => void
}

const EditPassesButton = ({ onSwitchToBuy }: EditPassesButtonProps) => {
  const { t } = useTranslation()
  const { toggleEditing, isEditing, attendeePasses } = usePassesProvider()

  const somePurchased = attendeePasses.some((attendee) =>
    attendee.products.some((product) => product.purchased),
  )

  if (!somePurchased) return null

  const handleEditClick = () => {
    toggleEditing()

    // If we're enabling edit mode and we have the switch function, call it
    if (!isEditing && onSwitchToBuy) {
      onSwitchToBuy()
    }
  }

  if (isEditing) {
    return (
      <Button
        variant="secondary"
        className="bg-muted text-foreground hover:shadow-md hover:bg-neutral-300 transition-all"
        onClick={() => toggleEditing()}
      >
        <XIcon className="w-4 h-4" />
        {t("passes.cancel_pass_editing")}
      </Button>
    )
  }

  return (
    <Button
      variant="outline"
      className="bg-card text-foreground hover:bg-card hover:shadow-md transition-all"
      onClick={handleEditClick}
    >
      <PencilIcon className="w-4 h-4" />
      {t("passes.edit_passes")}
    </Button>
  )
}

export default EditPassesButton
