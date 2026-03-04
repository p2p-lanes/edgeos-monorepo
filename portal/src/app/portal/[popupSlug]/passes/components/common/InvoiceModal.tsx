import { useTranslation } from "react-i18next"
import Modal from "@/components/ui/modal"
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
    <Modal
      open={isOpen}
      onClose={onClose}
      title={t("passes.invoices")}
      className="max-w-600px"
    >
      <div className="max-h-[500px] overflow-y-auto">
        <PaymentHistory payments={payments} />
      </div>
    </Modal>
  )
}
export default InvoiceModal
