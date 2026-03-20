"use client"

import { Minus, Plus, ShoppingBag } from "lucide-react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { formatCurrency } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

interface VariantProps {
  products: ProductsPass[]
  stepType: string
  onSkip?: () => void
}

export default function VariantQuantitySpinner({ products, stepType, onSkip }: VariantProps) {
  const { cart, addDynamicItem, updateDynamicQuantity } = useCheckout()
  const items = cart.dynamicItems[stepType] ?? []

  const getQty = (productId: string) =>
    items.find((i) => i.productId === productId)?.quantity ?? 0

  const handleChange = (product: ProductsPass, qty: number) => {
    if (qty <= 0) {
      updateDynamicQuantity(stepType, product.id, 0)
      return
    }
    addDynamicItem(stepType, {
      productId: product.id,
      product,
      quantity: qty,
      price: product.price * qty,
      stepType,
    })
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <ShoppingBag className="w-12 h-12 text-gray-300 mb-4" />
        <p className="text-gray-500 mb-6">No products available for this step.</p>
        <Button variant="outline" onClick={onSkip}>Continue</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-100">
        {products.map((product) => {
          const qty = getQty(product.id)
          const hasQty = qty > 0
          return (
            <div
              key={product.id}
              className={cn("p-4 flex items-center gap-3 transition-colors", hasQty ? "bg-blue-50/50" : "")}
            >
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleChange(product, qty - 1)}
                  disabled={qty === 0}
                  className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center transition-all",
                    qty === 0 ? "text-gray-300 cursor-not-allowed" : "text-gray-500 hover:bg-gray-100"
                  )}
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className={cn("w-6 text-center font-semibold text-sm", qty > 0 ? "text-blue-600" : "text-gray-400")}>
                  {qty}
                </span>
                <button
                  type="button"
                  onClick={() => handleChange(product, qty + 1)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-all"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </div>

              {product.image_url && (
                <div className="relative w-12 h-12 shrink-0 rounded-lg overflow-hidden bg-gray-100">
                  <Image src={product.image_url} alt={product.name} fill className="object-cover" />
                </div>
              )}

              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-900 text-sm">{product.name}</p>
                {product.description && (
                  <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">{product.description}</p>
                )}
              </div>

              <div className="text-right shrink-0">
                <span className={cn("font-semibold text-sm", hasQty ? "text-blue-600" : "text-gray-500")}>
                  {formatCurrency(hasQty ? product.price * qty : product.price)}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="text-center py-2">
        <button
          type="button"
          onClick={onSkip}
          className="text-gray-500 hover:text-gray-700 underline text-sm transition-colors"
        >
          Skip this step
        </button>
      </div>
    </div>
  )
}
