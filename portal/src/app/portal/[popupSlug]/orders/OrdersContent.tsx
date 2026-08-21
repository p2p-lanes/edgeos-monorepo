"use client"

import { Download, FileText, Loader2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { OpenAPI, type PaymentPublic } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { formatDate } from "@/helpers/dates"
import { formatCurrency } from "@/types/checkout"
import { type OrderStatus, projectOrders } from "./ordersProjection"

const statusVariant: Record<
  OrderStatus,
  "default" | "secondary" | "destructive"
> = {
  approved: "default",
  pending: "secondary",
  rejected: "destructive",
  expired: "secondary",
  cancelled: "secondary",
  unknown: "destructive",
}

function formattedAmount(value: string, currency: string) {
  const amount = Number(value)
  return Number.isFinite(amount) ? formatCurrency(amount, currency) : value
}

export function OrdersContent({
  payments,
  invoiceAvailable,
}: {
  payments: PaymentPublic[]
  invoiceAvailable: boolean
}) {
  const { t } = useTranslation()
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const orders = projectOrders(payments, invoiceAvailable)

  const downloadInvoice = async (paymentId: string) => {
    setDownloadingId(paymentId)
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
        `${OpenAPI.BASE}/api/v1/payments/my/${paymentId}/invoice`,
        { headers },
      )
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const blobUrl = window.URL.createObjectURL(await response.blob())
      const link = document.createElement("a")
      link.href = blobUrl
      link.download = `invoice-${paymentId}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(blobUrl)
    } catch (error: unknown) {
      console.error("Failed to download invoice:", error)
      toast.error(t("orders.download_invoice_error"))
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <section
      className="mx-auto max-w-3xl space-y-6 p-6"
      aria-labelledby="orders-title"
    >
      <div>
        <h1 id="orders-title" className="text-2xl font-semibold">
          {t("orders.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("orders.description")}
        </p>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-2xl border bg-card p-8 text-center">
          <FileText className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-3 font-semibold">{t("orders.empty_title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("orders.empty_description")}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <article key={order.id} className="rounded-2xl border bg-card p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusVariant[order.status]}>
                      {t(`orders.status.${order.status}`)}
                    </Badge>
                    {order.provenance === "legacy" && (
                      <Badge variant="outline">
                        {t("orders.legacy_purchase")}
                      </Badge>
                    )}
                  </div>
                  {order.createdAt && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {formatDate(order.createdAt)}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs text-muted-foreground">
                    {t("orders.total")}
                  </p>
                  <p className="font-semibold">
                    {formattedAmount(order.total, order.currency)}
                  </p>
                </div>
              </div>

              <ul
                className="mt-4 divide-y rounded-lg border"
                aria-label={t("orders.lines")}
              >
                {order.lines.map((line) => (
                  <li
                    key={line.id}
                    className="flex items-center justify-between gap-4 p-3 text-sm"
                  >
                    <div>
                      <p className="font-medium">{line.name}</p>
                      <p className="text-muted-foreground">
                        {t("orders.line_quantity", { count: line.quantity })} ·{" "}
                        {line.category}
                      </p>
                    </div>
                    <p>{formattedAmount(line.unitPrice, line.currency)}</p>
                  </li>
                ))}
              </ul>

              {order.invoiceAvailable && (
                <div className="mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={downloadingId === order.id}
                    onClick={() => downloadInvoice(order.id)}
                  >
                    {downloadingId === order.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" />
                    )}
                    {t("orders.invoice")}
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
