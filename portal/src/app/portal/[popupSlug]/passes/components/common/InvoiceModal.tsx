import { FileText } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import useGetPaymentsData from "@/hooks/useGetPaymentsData"
import PaymentHistory from "../Payments/PaymentHistory"

const InvoiceModal = ({
  isOpen,
  onClose,
}: {
  isOpen: boolean
  onClose: () => void
}) => {
  const { t } = useTranslation()
  const { payments } = useGetPaymentsData()

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-card rounded-lg p-0 max-w-2xl">
        <DialogHeader className="px-6 pt-6 pb-0">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            <DialogTitle className="text-lg font-semibold text-pass-title leading-none tracking-tight">
              {t("passes.invoices")}
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm text-muted-foreground mt-1">
            {t("passes.invoices_description")}
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-6">
          <PaymentHistory payments={payments} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
export default InvoiceModal
