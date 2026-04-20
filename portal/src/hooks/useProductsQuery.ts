import { useQuery } from "@tanstack/react-query"
import { ProductsService } from "@/client"
import type { TierGroupPublic, TierPhasePublic } from "@/client"
import { useIsAuthenticated } from "@/hooks/useIsAuthenticated"
import { queryKeys } from "@/lib/query-keys"
import type { ProductsPass } from "@/types/Products"

/** Server may return tier enrichment fields on list responses when the endpoint is upgraded. */
type ProductWithOptionalTier = {
  tier_group?: TierGroupPublic | null
  phase?: TierPhasePublic | null
}

export function useProductsQuery(popupId: string | null) {
  const isAuthenticated = useIsAuthenticated()
  return useQuery({
    queryKey: queryKeys.products.byPopup(popupId ?? ""),
    queryFn: async (): Promise<ProductsPass[]> => {
      const result = await ProductsService.listPortalProducts({
        popupId: popupId!,
      })
      return result.results.map((p) => {
        const withTier = p as typeof p & ProductWithOptionalTier
        return {
          ...p,
          price: Number(p.price),
          compare_price: p.compare_price ? Number(p.compare_price) : null,
          category: p.category ?? "other",
          // Forward tier enrichment fields when present (populated by tier-aware endpoints)
          tier_group: withTier.tier_group ?? null,
          phase: withTier.phase ?? null,
        }
      })
    },
    enabled: !!popupId && isAuthenticated,
    staleTime: 0,
    refetchInterval: 30_000,
  })
}
