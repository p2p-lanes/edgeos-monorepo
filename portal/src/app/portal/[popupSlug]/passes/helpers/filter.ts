import type { AttendeePassState } from "@/types/Attendee"
import type { ProductsPass } from "@/types/Products"

export const defaultProducts = (
  products: ProductsPass[],
  attendees: AttendeePassState[],
  discount: number,
): ProductsPass[] => {
  const mainAttendee = attendees.find((a) => a.category === "main") ?? {
    id: 0,
    products: [],
  }

  const hasDiscount = discount > 0
  const isPatreon = mainAttendee.products?.some((p) => p.category === "patreon")

  return products
    .filter((p) => p.is_active !== false)
    .map((p) => {
      if (p.category !== "patreon") {
        return {
          ...p,
          price: isPatreon
            ? 0
            : hasDiscount
              ? p.price * (1 - discount / 100)
              : p.price,
          original_price: hasDiscount ? p.price : p.compare_price,
        }
      }
      return { ...p, original_price: p.price }
    }) as ProductsPass[]
}

export const sortAttendees = (attendees: AttendeePassState[]) => {
  return attendees.sort((a, b) => {
    if (a.category === "main") return -1
    if (b.category === "main") return 1
    if (a.category === "spouse") return -1
    if (b.category === "spouse") return 1
    return 0
  })
}

export const filterProductsToPurchase = (
  products: ProductsPass[],
  editableMode: boolean,
) => {
  const reducedProducts = products.reduce((acc: ProductsPass[], product) => {
    const isDayProduct = product.duration_type === "day"
    const isWeekProduct = product.duration_type === "week"
    const isMonthProduct = product.duration_type === "month"
    const isPatreonProduct = product.category === "patreon"

    const hasMonth = products.some(
      (p) =>
        p.duration_type === "month" &&
        (p.selected || p.purchased) &&
        !p.edit &&
        p.attendee_category === product.attendee_category,
    )

    if (
      (!editableMode && !product.selected) ||
      (!product.purchased && !product.selected)
    )
      return acc

    if (product.selected) {
      if (product.purchased && !isDayProduct) return acc
      if (isWeekProduct && hasMonth) return acc
      if (
        isDayProduct &&
        (product.quantity === product.original_quantity || hasMonth)
      )
        return acc
      if (
        isDayProduct &&
        (product.quantity ?? 0) > (product.original_quantity ?? 0) &&
        !hasMonth
      ) {
        const newProduct = {
          ...product,
          quantity: editableMode
            ? (product.quantity ?? 0)
            : (product.quantity ?? 0) - (product.original_quantity ?? 0),
        }
        acc.push(newProduct)
        return acc
      }
      acc.push(product)
      return acc
    }

    if (editableMode) {
      if (isMonthProduct && product.purchased && !product.edit) {
        acc.push(product)
        return acc
      }

      if (isPatreonProduct && product.purchased) {
        acc.push(product)
        return acc
      }

      if (isWeekProduct && !hasMonth) {
        acc.push(product)
        return acc
      }

      if (isDayProduct && !hasMonth) {
        acc.push(product)
        return acc
      }
    }

    return acc
  }, [])

  return reducedProducts.map((p) => ({
    product_id: p.id,
    attendee_id: p.attendee_id,
    quantity: p.quantity ?? 1,
  }))
}
