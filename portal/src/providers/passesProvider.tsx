import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { sortAttendees } from "@/helpers/filters"
import { useCart } from "@/hooks/useCartApi"
import useGetPassesData from "@/hooks/useGetPassesData"
import { getPriceStrategy } from "@/strategies/PriceStrategy"
import { getProductStrategy } from "@/strategies/ProductStrategies"
import { getPurchaseStrategy } from "@/strategies/PurchaseStrategy"
import type { AttendeePassState } from "@/types/Attendee"
import type { ProductsPass } from "@/types/Products"
import { useApplication } from "./applicationProvider"
import { useCityProvider } from "./cityProvider"
import { useDiscount } from "./discountProvider"

interface PassesContext_interface {
  attendeePasses: AttendeePassState[]
  toggleProduct: (attendeeId: string, product: ProductsPass) => void
  products: ProductsPass[]
  isEditing: boolean
  toggleEditing: (editing?: boolean) => void
}

export const PassesContext = createContext<PassesContext_interface | null>(null)

interface PassesProviderProps {
  children: ReactNode
  restoreFromCart?: boolean
}

const PassesProvider = ({
  children,
  restoreFromCart = false,
}: PassesProviderProps) => {
  const { getAttendees } = useApplication()
  const { discountApplied } = useDiscount()
  const [attendeePasses, setAttendeePasses] = useState<AttendeePassState[]>([])

  const attendees = useMemo(() => {
    const result = sortAttendees(getAttendees())
    return result
  }, [getAttendees])

  const [isEditing, setIsEditing] = useState(false)
  const { products } = useGetPassesData()
  const { getCity } = useCityProvider()
  const city = getCity()
  const cityId = city?.id ? String(city.id) : null
  const previousCityIdRef = useRef(cityId)
  const attendeePassesRef = useRef<AttendeePassState[]>([])
  const { data: savedCartPasses } = useCart(restoreFromCart ? cityId : null)

  // Reset attendeePasses when city changes so stale data doesn't persist
  useEffect(() => {
    if (previousCityIdRef.current === cityId) return
    previousCityIdRef.current = cityId
    setAttendeePasses([])
    attendeePassesRef.current = []
    setIsEditing(false)
  }, [cityId])

  const toggleProduct = useCallback(
    (attendeeId: string, product: ProductsPass) => {
      if (!product) return
      const strategy = getProductStrategy(product, isEditing)
      const updatedAttendees = strategy.handleSelection(
        attendeePasses,
        attendeeId,
        product,
        discountApplied,
      )
      setAttendeePasses(updatedAttendees)
    },
    [attendeePasses, isEditing, discountApplied],
  )

  useEffect(() => {
    if (attendees.length > 0 && products.length > 0) {
      const initialAttendees = attendees.map((attendee) => {
        const hasPatreonPurchased = attendee.products.some(
          (p) => p.category === "patreon",
        )
        const priceStrategy = getPriceStrategy()
        const purchaseStrategy = getPurchaseStrategy()

        const attendeeProducts = products
          .filter(
            (product: ProductsPass) =>
              product.attendee_category === attendee.category &&
              product.is_active,
          )
          .map((product: ProductsPass) => {
            const originalQuantity =
              product.duration_type === "day"
                ? (attendees
                    .find((a) => a.id === attendee.id)
                    ?.products.find((p) => p.id === product.id)?.quantity ?? 0)
                : 1

            // Check if this pass was previously selected (ref) or saved in cart
            const refProduct = attendeePassesRef.current
              .find((a) => a.id === attendee.id)
              ?.products.find((p) => p.id === product.id)
            const cartPass =
              !refProduct?.selected
                ? savedCartPasses?.passes?.find(
                    (cp) =>
                      cp.attendee_id === attendee.id &&
                      cp.product_id === product.id,
                  )
                : undefined
            const isSelected = refProduct?.selected || !!cartPass
            const quantity =
              refProduct?.selected
                ? (refProduct.quantity ?? originalQuantity)
                : cartPass && product.duration_type === "day"
                  ? originalQuantity + cartPass.quantity
                  : originalQuantity

            return {
              ...product,
              original_quantity: originalQuantity,
              quantity,
              selected: isSelected,
              attendee_id: attendee.id,
              original_price: product.price,
              disabled: false,
              price: priceStrategy.calculatePrice(
                product,
                hasPatreonPurchased,
                discountApplied.discount_value,
              ),
            }
          })

        return {
          ...attendee,
          products: purchaseStrategy.applyPurchaseRules(
            attendeeProducts,
            attendee.products || [],
          ),
        }
      })
      setAttendeePasses(initialAttendees)
    }
  }, [attendees, products, discountApplied, savedCartPasses])

  useEffect(() => {
    attendeePassesRef.current = attendeePasses
  }, [attendeePasses])

  const toggleEditing = useCallback(
    (editing?: boolean) => {
      setAttendeePasses(
        attendeePasses.map((attendee) => ({
          ...attendee,
          products: attendee.products.map((product) => ({
            ...product,
            edit: false,
            selected: false,
            disabled: false,
          })),
        })),
      )

      setIsEditing(editing !== undefined ? editing : !isEditing)
    },
    [attendeePasses, isEditing],
  )

  // LEGACY: discount_assigned removed from ApplicationPublic

  return (
    <PassesContext.Provider
      value={{
        attendeePasses,
        toggleProduct,
        products,
        isEditing,
        toggleEditing,
      }}
    >
      {children}
    </PassesContext.Provider>
  )
}

export const usePassesProvider = (): PassesContext_interface => {
  const context = useContext(PassesContext)
  if (context === null) {
    throw new Error("usePassesProvider must be used within a PassesProvider")
  }
  return context
}

export default PassesProvider
