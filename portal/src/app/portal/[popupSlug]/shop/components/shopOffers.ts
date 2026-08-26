import type { SalesFlowPortalPublic } from "@/client"

export type ShopFlow = Pick<
  SalesFlowPortalPublic,
  "id" | "slug" | "name" | "price_summary"
>

export interface ShopOffer {
  key: "application" | "direct" | "upsale"
  flows: ShopFlow[]
}

interface ShopOfferCollections {
  application: ShopFlow[]
  direct: ShopFlow[]
  upsale: ShopFlow[]
  isApplicationApproved: boolean
}

export function getEligibleShopOffers({
  application,
  direct,
  upsale,
  isApplicationApproved,
}: ShopOfferCollections): ShopOffer[] {
  return [
    ...(isApplicationApproved && application.length > 0
      ? [{ key: "application" as const, flows: application }]
      : []),
    ...(direct.length > 0 ? [{ key: "direct" as const, flows: direct }] : []),
    ...(upsale.length > 0 ? [{ key: "upsale" as const, flows: upsale }] : []),
  ]
}
