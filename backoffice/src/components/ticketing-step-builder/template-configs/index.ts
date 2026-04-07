import type { ComponentType } from "react"
import { HousingDateConfig } from "./HousingDateConfig"
import { MerchImageConfig } from "./MerchImageConfig"
import { PatronPresetConfig } from "./PatronPresetConfig"
import { TicketSelectConfig } from "./TicketSelectConfig"
import type { TemplateConfigProps } from "./types"

export type { TemplateConfigProps }

export const TEMPLATE_CONFIG_REGISTRY: Record<
  string,
  ComponentType<TemplateConfigProps>
> = {
  "ticket-select": TicketSelectConfig,
  "patron-preset": PatronPresetConfig,
  "housing-date": HousingDateConfig,
  "merch-image": MerchImageConfig,
}
