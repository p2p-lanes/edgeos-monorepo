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

export default function VariantMerchImage({ products, stepType, onSkip }: VariantProps) {
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
        <p className="text-gray-500 mb-6">No merchandise available.</p>
        <Button variant="outline" onClick={onSkip}>Continue</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {products.map((product) => {
          const qty = getQty(product.id)
          const hasQty = qty > 0
          const hasDiscount = product.compare_price != null && product.compare_price > product.price

          return (
            <div
              key={product.id}
              className={cn(
                "rounded-2xl border overflow-hidden bg-white transition-all",
                hasQty ? "border-blue-200" : "border-gray-200"
              )}
            >
              <div className="relative w-full aspect-square bg-gray-100 flex items-center justify-center">
                {product.image_url ? (
                  <Image src={product.image_url} alt={product.name} fill className="object-cover" />
                ) : (
                  <ShoppingBag className="w-10 h-10 text-gray-300" />
                )}
              </div>
              <div className="p-3">
                <p className="font-semibold text-gray-900 text-sm leading-tight">{product.name}</p>
                {product.description && (
                  <p className="text-xs text-gray-500 line-clamp-2 mt-0.5">{product.description}</p>
                )}
                <div className="flex items-center justify-between mt-2">
                  <div>
                    {hasDiscount && product.compare_price != null && (
                      <p className="text-xs text-gray-400 line-through">{formatCurrency(product.compare_price)}</p>
                    )}
                    <span className={cn("font-bold text-sm", hasQty ? "text-blue-600" : hasDiscount ? "text-green-600" : "text-gray-900")}>
                      {formatCurrency(hasQty ? product.price * qty : product.price)}
                    </span>
                  </div>
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
                      <Minus className="w-3.5 h-3.5" />
                    </button>
                    <span className={cn("w-5 text-center font-semibold text-sm", qty > 0 ? "text-blue-600" : "text-gray-400")}>
                      {qty}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleChange(product, qty + 1)}
                      className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 transition-all"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
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
          Skip merchandise
        </button>
      </div>
    </div>
  )
}
