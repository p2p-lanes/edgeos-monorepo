"use client"

import { Check, Ticket } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { formatCheckoutDate, formatCurrency } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"
import type { VariantProps } from "../DynamicProductStep"

interface TemplateSection {
  key: string
  label: string
  order: number
  product_ids: string[]
}

function groupBySection(
  products: ProductsPass[],
  sections: TemplateSection[],
): { section: TemplateSection; products: ProductsPass[] }[] {
  const groups: { section: TemplateSection; products: ProductsPass[] }[] = []

  for (const section of [...sections].sort((a, b) => a.order - b.order)) {
    const sectionProducts: ProductsPass[] = []

    for (const pid of section.product_ids) {
      const product = products.find((p) => p.id === pid)
      if (product) {
        sectionProducts.push(product)
      }
    }

    if (sectionProducts.length > 0) {
      groups.push({ section, products: sectionProducts })
    }
  }

  // Unassigned products go into an "Other" section
  const assignedIds = new Set(sections.flatMap((s) => s.product_ids))
  const unassigned = products.filter((p) => !assignedIds.has(p.id))
  if (unassigned.length > 0) {
    groups.push({
      section: { key: "__other", label: "Other", order: 999, product_ids: [] },
      products: unassigned,
    })
  }

  return groups
}

export default function VariantTicketSelect({
  products,
  stepType,
  onSkip,
  templateConfig,
}: VariantProps) {
  const { cart, addDynamicItem, removeDynamicItem } = useCheckout()
  const items = cart.dynamicItems[stepType] ?? []

  const isSelected = (productId: string) =>
    items.some((i) => i.productId === productId)

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
        <Ticket className="w-12 h-12 text-gray-300 mb-4" />
        <p className="text-gray-500 mb-6">
          No products available for this step.
        </p>
        <Button variant="outline" onClick={onSkip}>
          Continue
        </Button>
      </div>
    )
  }

  const sections = (templateConfig?.sections ?? null) as
    | TemplateSection[]
    | null

  const hasSections = Array.isArray(sections) && sections.length > 0
  const groups = hasSections ? groupBySection(products, sections) : null

  const renderProduct = (product: ProductsPass) => {
    const selected = isSelected(product.id)
    return (
      <button
        key={product.id}
        type="button"
        onClick={() => toggle(product)}
        className={cn(
          "w-full p-4 flex items-center gap-3 text-left transition-colors",
          selected ? "bg-blue-50/50" : "hover:bg-gray-50",
        )}
      >
        <div
          className={cn(
            "w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors",
            selected ? "border-blue-600 bg-blue-600" : "border-gray-300",
          )}
        >
          {selected && <Check className="w-3 h-3 text-white" />}
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-medium text-gray-900 text-sm">{product.name}</p>
          {product.description && (
            <p className="text-xs text-gray-500 line-clamp-1 mt-0.5">
              {product.description}
            </p>
          )}
          {(product.start_date || product.end_date) && (
            <p className="text-xs text-gray-400 mt-0.5">
              {product.start_date && formatCheckoutDate(product.start_date)}
              {product.start_date && product.end_date && " \u2013 "}
              {product.end_date && formatCheckoutDate(product.end_date)}
            </p>
          )}
        </div>

        <div className="text-right shrink-0">
          {product.compare_price != null &&
            product.compare_price > product.price && (
              <p className="text-xs text-gray-400 line-through">
                {formatCurrency(product.compare_price)}
              </p>
            )}
          <span
            className={cn(
              "font-semibold text-sm",
              selected ? "text-blue-600" : "text-gray-700",
            )}
          >
            {formatCurrency(product.price)}
          </span>
        </div>
      </button>
    )
  }

  return (
    <div className="space-y-4">
      {groups ? (
        <div className="space-y-4">
          {groups.map(({ section, products: sectionProducts }) => (
            <div
              key={section.key}
              className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden"
            >
              <div
                className="relative px-5 py-2 bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100 overflow-hidden"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(135deg, transparent, transparent 4px, rgba(0,0,0,0.03) 4px, rgba(0,0,0,0.03) 5px)",
                }}
              >
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide relative">
                  {section.label}
                </h4>
              </div>
              <div className="divide-y divide-gray-100">
                {sectionProducts.map(renderProduct)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden divide-y divide-gray-100">
          {products.map(renderProduct)}
        </div>
      )}

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
