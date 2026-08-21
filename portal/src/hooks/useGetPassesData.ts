import { useCityProvider } from "@/providers/cityProvider"
import { useProductsQuery } from "./useProductsQuery"

const useGetPassesData = (salesFlowId?: string | null) => {
  const { getCity } = useCityProvider()
  const city = getCity()
  const {
    data: products = [],
    isLoading: loading,
    refetch,
  } = useProductsQuery(city ? String(city.id) : null, salesFlowId)

  return { products, loading, refreshProductsData: refetch }
}

export default useGetPassesData
