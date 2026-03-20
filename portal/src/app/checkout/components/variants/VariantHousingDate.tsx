"use client"

import { Calendar, Check } from "lucide-react"
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

export default function VariantHousingDate({ products, stepType, onSkip }: VariantProps) {
  const { cart, addDynamicItem, removeDynamicItem } = useCheckout()
  const items = cart.dynamicItems[stepType] ?? []

  const selectedId = items[0]?.productId

  const select = (product: ProductsPass) => {
    if (selectedId === product.id) {
      removeDynamicItem(stepType, product.id)
      return
    }
    // Clear previous selection
    if (selectedId) removeDynamicItem(stepType, selectedId)
    addDynamicItem(stepType, {
      productId: product.id,
      product,
      quantity: 1,
      price: product.price,
      stepType,
    })
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <Calendar className="w-12 h-12 text-gray-300 mb-4" />
        <p className="text-gray-500 mb-6">No housing options available.</p>
        <Button variant="outline" onClick={onSkip}>Continue</Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {products.map((product) => {
        const isSelected = selectedId === product.id
        return (
          <button
            key={product.id}
            type="button"
            onClick={() => select(product)}
            className={cn(
              "w-full rounded-2xl border overflow-hidden text-left transition-all",
              isSelected ? "border-blue-600 ring-2 ring-blue-600/20" : "border-gray-200 hover:border-gray-300"
            )}
          >
            {product.image_url && (
              <div className="relative w-full aspect-[16/7] bg-gray-100">
                <Image src={product.image_url} alt={product.name} fill className="object-cover" />
                {isSelected && (
                  <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center">
                    <Check className="w-4 h-4 text-white" />
                  </div>
                )}
              </div>
            )}
            <div className={cn("p-4 bg-white", !product.image_url && isSelected ? "ring-2 ring-inset ring-blue-600" : "")}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-gray-900">{product.name}</p>
                  {product.description && (
                    <p className="text-sm text-gray-500 mt-0.5 line-clamp-2">{product.description}</p>
                  )}
                  {(product.start_date || product.end_date) && (
                    <div className="flex items-center gap-1 mt-1 text-xs text-gray-400">
                      <Calendar className="w-3 h-3" />
                      <span>
                        {product.start_date && formatCheckoutDate(product.start_date)}
                        {product.start_date && product.end_date && " – "}
                        {product.end_date && formatCheckoutDate(product.end_date)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  {product.compare_price != null && product.compare_price > product.price && (
                    <p className="text-xs text-gray-400 line-through">{formatCurrency(product.compare_price)}</p>
                  )}
                  <p className={cn("font-bold", isSelected ? "text-blue-600" : "text-gray-900")}>
                    {formatCurrency(product.price)}
                  </p>
                </div>
              </div>
            </div>
          </button>
        )
      })}

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
