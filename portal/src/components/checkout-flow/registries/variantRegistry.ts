import type { ComponentType } from "react"
import type { ProductsPass } from "@/types/Products"
import VariantFaqs from "../variants/VariantFaqs"
import VariantHero from "../variants/VariantHero"
import VariantHousingDate from "../variants/VariantHousingDate"
import VariantImageGallery from "../variants/VariantImageGallery"
import VariantMealPlanSelect from "../variants/VariantMealPlanSelect"
import VariantMerchImage from "../variants/VariantMerchImage"
import VariantPatronPreset from "../variants/VariantPatronPreset"
import VariantRichText from "../variants/VariantRichText"
import VariantTicketCard from "../variants/VariantTicketCard"
import VariantTicketSelect from "../variants/VariantTicketSelect"
import VariantYouTubeVideo from "../variants/VariantYouTubeVideo"

export interface VariantProps {
  products: ProductsPass[]
  stepType: string
  onSkip?: () => void
  templateConfig?: Record<string, unknown> | null
  /** True when the variant renders inside the first checkout section, i.e.
   *  above the fold on first paint. Variants use it to load their images
   *  eagerly with high fetch priority (LCP) instead of lazily. */
  isFirstSection?: boolean
}

export const VARIANT_REGISTRY: Record<string, ComponentType<VariantProps>> = {
  "ticket-select": VariantTicketSelect,
  "ticket-card": VariantTicketCard,
  "patron-preset": VariantPatronPreset,
  "housing-date": VariantHousingDate,
  "merch-image": VariantMerchImage,
  "meal-plan-select": VariantMealPlanSelect,
  "youtube-video": VariantYouTubeVideo,
  "image-gallery": VariantImageGallery,
  faqs: VariantFaqs,
  "rich-text": VariantRichText,
  hero: VariantHero,
}

export const CONTENT_ONLY_TEMPLATES = new Set([
  "youtube-video",
  "image-gallery",
  "faqs",
  "rich-text",
  "hero",
])
