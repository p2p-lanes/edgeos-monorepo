import type { ComponentType } from "react"
import type { ProductsPass } from "@/types/Products"
import VariantHousingDate from "../variants/VariantHousingDate"
import VariantImageGallery from "../variants/VariantImageGallery"
import VariantMerchImage from "../variants/VariantMerchImage"
import VariantPatronPreset from "../variants/VariantPatronPreset"
import VariantTicketSelect from "../variants/VariantTicketSelect"
import VariantYouTubeVideo from "../variants/VariantYouTubeVideo"

export interface VariantProps {
  products: ProductsPass[]
  stepType: string
  onSkip?: () => void
  templateConfig?: Record<string, unknown> | null
}

export const VARIANT_REGISTRY: Record<string, ComponentType<VariantProps>> = {
  "ticket-select": VariantTicketSelect,
  "patron-preset": VariantPatronPreset,
  "housing-date": VariantHousingDate,
  "merch-image": VariantMerchImage,
  "youtube-video": VariantYouTubeVideo,
  "image-gallery": VariantImageGallery,
}

export const CONTENT_ONLY_TEMPLATES = new Set([
  "youtube-video",
  "image-gallery",
])
