import { useMemo } from "react"
import type { TicketingStepPublic } from "@/client"
import { CONTENT_ONLY_TEMPLATES } from "@/components/checkout-flow/registries/variantRegistry"
import type { ProductsPass } from "@/types/Products"

export interface StepProductResolution {
  /** Map<stepId, ProductsPass[]> — product list per configured step. */
  productsByStepId: Map<string, ProductsPass[]>
  /** Convenience accessor; returns [] when step is unknown or has no resolved products. */
  getProductsForStep: (
    step: TicketingStepPublic | null | undefined,
  ) => ProductsPass[]
}

function resolveProductsForStep(
  step: TicketingStepPublic,
  allProducts: ProductsPass[],
): ProductsPass[] {
  // Content-only templates have no products by design.
  if (step.template && CONTENT_ONLY_TEMPLATES.has(step.template)) return []
  // Confirm step never resolves products.
  if (step.step_type === "confirm") return []
  // No category configured → empty list (silent skip per Decision #2 of proposal).
  if (!step.product_category) return []
  const target = step.product_category.toLowerCase()
  return allProducts.filter(
    (p) => p.is_active && p.category.toLowerCase() === target,
  )
}

export function useStepProductResolver(
  configuredSteps: TicketingStepPublic[],
  products: ProductsPass[],
): StepProductResolution {
  const productsByStepId = useMemo(() => {
    const map = new Map<string, ProductsPass[]>()
    for (const step of configuredSteps) {
      map.set(step.id, resolveProductsForStep(step, products))
    }
    return map
  }, [configuredSteps, products])

  const getProductsForStep = useMemo(
    () =>
      (step: TicketingStepPublic | null | undefined): ProductsPass[] => {
        if (!step) return []
        return productsByStepId.get(step.id) ?? []
      },
    [productsByStepId],
  )

  return { productsByStepId, getProductsForStep }
}
