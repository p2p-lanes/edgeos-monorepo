import { Package } from "lucide-react"
import type { TicketingStepPublic } from "@/client"
import { type LucideLikeIcon, resolveStepIcon } from "@/lib/checkoutStepIcons"
import type { OtherPurchasedProduct } from "./otherProductsProjection"

export interface OtherProductVisual {
  imageUrl: string | null
  Icon: LucideLikeIcon
}

interface CatalogImage {
  id: string
  image_url?: string | null
}

function sectionImageFor(
  steps: TicketingStepPublic[],
  productId: string,
): string | null {
  for (const step of steps) {
    const sections = (step.template_config as { sections?: unknown } | null)
      ?.sections
    if (!Array.isArray(sections)) continue
    for (const section of sections) {
      const { product_ids: ids, image_url: image } = (section ?? {}) as {
        product_ids?: unknown
        image_url?: unknown
      }
      if (
        Array.isArray(ids) &&
        ids.includes(productId) &&
        typeof image === "string" &&
        image
      ) {
        return image
      }
    }
  }
  return null
}

/**
 * What stands in front of a product in "Other products".
 *
 * Everything here is already configured in the backoffice, so an organizer
 * changes it where they set the product up: the product's own image, else the
 * image of the checkout card it was sold under, else the icon chosen for the
 * checkout step that sells its category. A generic box only when the product
 * matches none of them.
 */
export function resolveOtherProductVisual(
  product: Pick<OtherPurchasedProduct, "id" | "category">,
  steps: TicketingStepPublic[],
  catalog: CatalogImage[],
): OtherProductVisual {
  const imageUrl =
    catalog.find((item) => item.id === product.id)?.image_url ||
    sectionImageFor(steps, product.id)

  const category = product.category.toLowerCase()
  const step = steps.find(
    (candidate) =>
      candidate.step_type !== "confirm" &&
      candidate.product_category?.toLowerCase() === category,
  )
  const Icon = step
    ? resolveStepIcon({
        stepType: step.step_type,
        template: step.template,
        emoji: step.emoji,
      })
    : Package

  return { imageUrl: imageUrl || null, Icon }
}
