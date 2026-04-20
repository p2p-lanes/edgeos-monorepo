import type { ComponentType } from "react"
import { FaqsConfig } from "./FaqsConfig"
import { HousingDateConfig } from "./HousingDateConfig"
import { ImageGalleryConfig } from "./ImageGalleryConfig"
import { MerchImageConfig } from "./MerchImageConfig"
import { PatronPresetConfig } from "./PatronPresetConfig"
import { TicketSelectConfig } from "./TicketSelectConfig"
import type { TemplateConfigProps } from "./types"
import { YouTubeVideoConfig } from "./YouTubeVideoConfig"

export type { TemplateConfigProps }

export const TEMPLATE_CONFIG_REGISTRY: Record<
  string,
  ComponentType<TemplateConfigProps>
> = {
  "ticket-select": TicketSelectConfig,
  "patron-preset": PatronPresetConfig,
  "housing-date": HousingDateConfig,
  "merch-image": MerchImageConfig,
  "youtube-video": YouTubeVideoConfig,
  "image-gallery": ImageGalleryConfig,
  faqs: FaqsConfig,
}
