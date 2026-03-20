"use client"

import { Check, LayoutGrid } from "lucide-react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { formatCheckoutDate, formatCurrency } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"

interface VariantProps {
  products: ProductsPass[]
  stepType: string
  onSkip?: () => void
}

export default function VariantTicketCard({ products, stepType, onSkip }: VariantProps) {
  const { cart, addDynamicItem, removeDynamicItem } = useCheckout()
  const items = cart.dynamicItems[stepType] ?? []

  const isSelected = (productId: string) => items.some((i) => i.productId === productId)

  const toggle = (product: ProductsPass) => {
    if (isSelected(product.id)) {
      removeDynamicItem(stepType, product.id)
    } else {
      addDynamicItem(stepType, {
        productId: product.id,
        product,
        quantity: 1,
        price: product.price,
        stepType,
      })
    }
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <LayoutGrid className="w-12 h-12 text-gray-300 mb-4" />
        <p className="text-gray-500 mb-6">No products available for this step.</p>
        <Button variant="outline" onClick={onSkip}>Continue</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {products.map((product) => {
          const selected = isSelected(product.id)
          return (
            <button
              key={product.id}
              type="button"
              onClick={() => toggle(product)}
              className={cn(
                "relative flex flex-col rounded-2xl border overflow-hidden text-left transition-all",
                selected ? "border-blue-600 ring-2 ring-blue-600/20" : "border-gray-200 hover:border-gray-300"
              )}
            >
              {product.image_url ? (
                <div className="relative w-full aspect-[4/3] bg-gray-100">
                  <Image src={product.image_url} alt={product.name} fill className="object-cover" />
                </div>
              ) : (
                <div className="w-full aspect-[4/3] bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                  <LayoutGrid className="w-8 h-8 text-gray-300" />
                </div>
              )}

              {selected && (
                <div className="absolute top-2 right-2 w-6 h-6 rounded-full bg-blue-600 flex items-center justify-center">
                  <Check className="w-3.5 h-3.5 text-white" />
                </div>
              )}

              <div className="p-3">
                <p className="font-semibold text-gray-900 text-sm leading-tight">{product.name}</p>
                {product.description && (
                  <p className="text-xs text-gray-500 line-clamp-2 mt-1">{product.description}</p>
                )}
                {(product.start_date || product.end_date) && (
                  <p className="text-xs text-gray-400 mt-1">
                    {product.start_date && formatCheckoutDate(product.start_date)}
                    {product.start_date && product.end_date && " – "}
                    {product.end_date && formatCheckoutDate(product.end_date)}
                  </p>
                )}
                <div className="flex items-center justify-between mt-2">
                  {product.compare_price != null && product.compare_price > product.price ? (
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-400 line-through">{formatCurrency(product.compare_price)}</span>
                      <span className="font-bold text-green-600 text-sm">{formatCurrency(product.price)}</span>
                    </div>
                  ) : (
                    <span className={cn("font-bold text-sm", selected ? "text-blue-600" : "text-gray-900")}>
                      {formatCurrency(product.price)}
                    </span>
                  )}
                  <span className={cn(
                    "text-xs px-2 py-0.5 rounded-full font-medium",
                    selected ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-500"
                  )}>
                    {selected ? "Selected" : "Select"}
                  </span>
                </div>
              </div>
            </button>
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
