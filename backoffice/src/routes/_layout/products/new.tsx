import { createFileRoute, useNavigate } from "@tanstack/react-router"
import { useEffect } from "react"

import { FormPageLayout } from "@/components/Common/FormPageLayout"
import { ProductForm } from "@/components/forms/ProductForm"
import useAuth from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout/products/new")({
  component: NewProduct,
  head: () => ({
    meta: [{ title: "New Product - EdgeOS" }],
  }),
})

function NewProduct() {
  const navigate = useNavigate()
  const { isOperatorOrAbove, isUserLoading } = useAuth()

  // Redirect viewers to products list - they cannot create new products
  useEffect(() => {
    if (!isUserLoading && !isOperatorOrAbove) {
      navigate({ to: "/products" })
    }
  }, [isOperatorOrAbove, isUserLoading, navigate])

  if (isUserLoading || !isOperatorOrAbove) {
    return null
  }

  return (
    <FormPageLayout
      title="Create Product"
      description="Add a new product or ticket type"
      backTo="/products"
    >
      <ProductForm onSuccess={() => navigate({ to: "/products" })} />
    </FormPageLayout>
  )
}
