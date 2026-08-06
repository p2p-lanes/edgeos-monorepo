import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { AlertTriangle } from "lucide-react"
import { useEffect, useState } from "react"

import { ProductsService, SalesFlowsService } from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { InlineSection } from "@/components/ui/inline-form"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

interface FlowProductsSectionProps {
  popupId: string
  flowId: string
}

/**
 * sdd/sales-flows-rediseno slice 4b: a product is sold through a flow only
 * when it is assigned to it, so this is where an operator decides what a
 * flow can sell. Unassigning affects this flow only — the product keeps its
 * stock and its assignments to every other flow.
 */
export function FlowProductsSection({
  popupId,
  flowId,
}: FlowProductsSectionProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const { data: productsData, isLoading: isLoadingProducts } = useQuery({
    queryKey: ["products", popupId, "for-flow-assignment"],
    queryFn: () => ProductsService.listProducts({ popupId, limit: 200 }),
  })

  const { data: assigned, isLoading: isLoadingAssigned } = useQuery({
    queryKey: ["sales-flows", flowId, "products"],
    queryFn: () => SalesFlowsService.listFlowProducts({ flowId }),
  })

  const [selected, setSelected] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (assigned) setSelected(new Set(assigned.product_ids))
  }, [assigned])

  const saveMutation = useMutation({
    mutationFn: () =>
      SalesFlowsService.setFlowProducts({
        flowId,
        requestBody: { product_ids: Array.from(selected) },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["sales-flows", flowId, "products"],
      })
      showSuccessToast("Products updated")
    },
    onError: createErrorHandler(showErrorToast),
  })

  if (isLoadingProducts || isLoadingAssigned) {
    return <Skeleton className="h-40 w-full" />
  }

  const products = productsData?.results ?? []
  const savedIds = new Set(assigned?.product_ids ?? [])
  const isDirty =
    selected.size !== savedIds.size ||
    Array.from(selected).some((id) => !savedIds.has(id))

  const toggle = (productId: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(productId)) {
        next.delete(productId)
      } else {
        next.add(productId)
      }
      return next
    })
  }

  return (
    <InlineSection title="Products">
      <p className="px-1 text-xs text-muted-foreground">
        Only the products checked here are sold through this flow. Stock is
        shared with every other flow selling the same product.
      </p>

      {products.length === 0 ? (
        <p className="px-1 py-2 text-sm text-muted-foreground">
          This event has no products yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2 px-1 py-2">
          {products.map((product) => (
            <div key={product.id} className="flex items-center gap-2">
              <Checkbox
                id={`flow-product-${product.id}`}
                checked={selected.has(product.id)}
                onCheckedChange={() => toggle(product.id)}
              />
              <Label
                htmlFor={`flow-product-${product.id}`}
                className="text-sm font-normal"
              >
                {product.name}
                <span className="ml-2 text-xs text-muted-foreground">
                  {product.category}
                </span>
              </Label>
            </div>
          ))}
        </div>
      )}

      {selected.size === 0 && products.length > 0 && (
        <p className="flex items-center gap-2 px-1 text-xs text-amber-600 dark:text-amber-500">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          This flow cannot sell anything until at least one product is checked.
        </p>
      )}

      <div className="flex justify-end px-1 pt-1">
        <Button
          type="button"
          size="sm"
          disabled={!isDirty || saveMutation.isPending}
          onClick={() => saveMutation.mutate()}
        >
          {saveMutation.isPending ? "Saving..." : "Save products"}
        </Button>
      </div>
    </InlineSection>
  )
}
