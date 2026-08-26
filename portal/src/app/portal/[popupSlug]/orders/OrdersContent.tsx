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
      className="mx-auto max-w-6xl space-y-6 p-4 sm:p-6"
      aria-labelledby="orders-title"
    >
      <div>
        <h1
          id="orders-title"
          className="text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl"
        >
          {t("orders.title")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("orders.description")}
        </p>
      </div>

      {orders.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-10 text-center shadow-sm">
          <div className="mx-auto grid size-12 place-items-center rounded-full bg-muted">
            <FileText className="size-6 text-muted-foreground" />
          </div>
          <h2 className="mt-3 font-semibold">{t("orders.empty_title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("orders.empty_description")}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((order) => (
            <article
              key={order.id}
              className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
            >
              <div className="grid gap-4 p-4 sm:grid-cols-[minmax(9rem,0.8fr)_minmax(0,1.5fr)_minmax(9rem,0.8fr)] sm:items-center sm:p-5">
                <div className="space-y-2">
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

                <ul
                  className="divide-y divide-slate-100 border-y border-slate-100"
                  aria-label={t("orders.lines")}
                >
                  {order.lines.map((line) => (
                    <li
                      key={line.id}
                      className="flex items-center justify-between gap-4 py-3 text-sm first:pt-0 last:pb-0"
                    >
                      <div>
                        <p className="font-medium">{line.name}</p>
                        <p className="text-muted-foreground">
                          {t("orders.line_quantity", { count: line.quantity })}{" "}
                          · {line.category}
                        </p>
                      </div>
                      <p>{formattedAmount(line.unitPrice, line.currency)}</p>
                    </li>
                  ))}
                </ul>

                <div className="flex items-end justify-between gap-3 sm:flex-col sm:items-end sm:text-right">
                  <p className="text-xs text-muted-foreground">
                    {t("orders.total")}
                  </p>
                  <p className="text-xl font-semibold tracking-tight text-slate-950">
                    {formattedAmount(order.total, order.currency)}
                  </p>
                  {order.invoiceAvailable && (
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
                  )}
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
