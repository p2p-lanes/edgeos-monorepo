"use client"

import { Minus, Plus } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { CheckoutRuntimeProduct } from "@/client"
import { Button } from "@/components/ui/button"
import { formatCurrency } from "@/types/checkout"

interface ProductPickerProps {
  products: CheckoutRuntimeProduct[]
  quantities: Record<string, number>
  onChange: (productId: string, quantity: number) => void
}

export function ProductPicker({
  products,
  quantities,
  onChange,
}: ProductPickerProps) {
  const { t } = useTranslation()
  return (
    <section className="space-y-4 rounded-2xl border bg-card p-6 shadow-sm">
      <div>
        <h2 className="text-xl font-semibold">
          {t("openCheckout.tickets_title")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("openCheckout.tickets_subtitle")}
        </p>
      </div>

      <div className="space-y-4">
        {products.map((product) => {
          const quantity = quantities[product.id] ?? 0
          const maxQuantity = product.max_quantity ?? 99

          return (
            <div
              key={product.id}
              className="flex flex-col gap-4 rounded-xl border p-4 md:flex-row md:items-center md:justify-between"
            >
              <div className="space-y-1">
                <h3 className="font-medium">{product.name}</h3>
                {product.description ? (
                  <p className="text-sm text-muted-foreground">
                    {product.description}
                  </p>
                ) : null}
                <p className="text-sm font-medium">
                  {formatCurrency(Number(product.price), product.currency)}
                </p>
              </div>

              <div className="flex items-center gap-3 self-start md:self-center">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    onChange(product.id, Math.max(0, quantity - 1))
                  }
                  disabled={quantity <= 0}
                >
                  <Minus className="size-4" />
                </Button>
                <span className="min-w-8 text-center text-lg font-semibold">
                  {quantity}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() =>
                    onChange(product.id, Math.min(maxQuantity, quantity + 1))
                  }
                  disabled={quantity >= maxQuantity}
                >
                  <Plus className="size-4" />
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
