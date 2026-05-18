import { useSuspenseQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { Suspense } from "react"

import { ProductsService } from "@/client"
import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { ProductForm } from "@/components/forms/ProductForm"
import { Skeleton } from "@/components/ui/skeleton"
import { useGoBack } from "@/hooks/useGoBack"

export const Route = createFileRoute("/_layout/products/$id/edit")({
  component: EditProductPage,
  head: () => ({
    meta: [{ title: "Edit Product - EdgeOS" }],
  }),
})

function getProductQueryOptions(productId: string) {
  return {
    queryKey: ["products", productId],
    queryFn: () => ProductsService.getProduct({ productId }),
  }
}

function EditProductContent({ productId }: { productId: string }) {
  const goBack = useGoBack({ to: "/products" })
  const { data: product } = useSuspenseQuery(getProductQueryOptions(productId))

  return <ProductForm defaultValues={product} onSuccess={goBack} />
}

function EditProductPage() {
  const { id } = Route.useParams()

  return (
    <FormPageLayout
      title="Edit Product"
      description="Update product details and pricing"
      backTo="/products"
    >
      <QueryErrorBoundary>
        <Suspense fallback={<Skeleton className="h-96 w-full" />}>
          <EditProductContent productId={id} />
        </Suspense>
      </QueryErrorBoundary>
    </FormPageLayout>
  )
}
