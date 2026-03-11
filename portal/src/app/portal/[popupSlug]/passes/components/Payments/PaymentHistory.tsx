"use client"

import { Download, FileText, Loader2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"
import { OpenAPI } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDate } from "@/helpers/dates"
import { useApplication } from "@/providers/applicationProvider"
import type { PaymentsProps } from "@/types/passes"

const PaymentHistory = ({ payments }: { payments: PaymentsProps[] }) => {
  const { getRelevantApplication } = useApplication()
  const application = getRelevantApplication()
  const approvedPayments = payments?.filter(
    (payment) => payment.status === "approved",
  )
  const [downloadingId, setDownloadingId] = useState<number | null>(null)

  if (!approvedPayments || approvedPayments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <FileText className="h-10 w-10 text-muted-foreground/40 mb-3" />
        <p className="text-sm font-medium text-muted-foreground">
          No invoices available
        </p>
        <p className="text-xs text-muted-foreground/60 mt-1">
          Invoices will appear here once payments are confirmed
        </p>
      </div>
    )
  }

  const handleDownloadInvoice = async (payment: PaymentsProps) => {
    if (!application) return

    setDownloadingId(payment.id)
    try {
      const token =
        typeof OpenAPI.TOKEN === "function"
          ? await OpenAPI.TOKEN({ method: "GET", url: "" })
          : OpenAPI.TOKEN
      const tenantId = localStorage.getItem("portal_tenant_id")

      const headers: Record<string, string> = {}
      if (token) headers.Authorization = `Bearer ${token}`
      if (tenantId) headers["X-Tenant-Id"] = tenantId

      const response = await fetch(
        `${OpenAPI.BASE}/api/v1/payments/my/${payment.id}/invoice`,
        { headers },
      )

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const blob = await response.blob()
      const blobUrl = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = blobUrl

      const clientName = application.human
        ? `${application.human.first_name ?? ""} ${application.human.last_name ?? ""}`.trim()
        : "invoice"
      link.download = `${clientName}-invoice.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(blobUrl)
    } catch (error: unknown) {
      console.error("Error downloading invoice:", error)
      toast.error("Failed to download invoice. Please try again.")
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="font-semibold">Date</TableHead>
            <TableHead className="font-semibold">Amount</TableHead>
            <TableHead className="font-semibold">Products</TableHead>
            <TableHead className="font-semibold text-right">Invoice</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {approvedPayments.map((payment) => (
            <TableRow key={payment.id}>
              <TableCell className="text-left text-muted-foreground">
                {formatDate(payment.created_at)}
              </TableCell>
              <TableCell className="font-mono font-medium">
                ${payment.amount} {payment.currency}
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className="font-normal">
                  {payment.products_snapshot.length}{" "}
                  {payment.products_snapshot.length === 1 ? "item" : "items"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                {payment.amount > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={downloadingId === payment.id}
                    onClick={() => handleDownloadInvoice(payment)}
                    className="gap-1.5"
                  >
                    {downloadingId === payment.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Download className="w-3.5 h-3.5" />
                    )}
                    PDF
                  </Button>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

export default PaymentHistory
