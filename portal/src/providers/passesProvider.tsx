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
import type { AttendeePurchases } from "@/client"
import { supportsQuantitySelector } from "@/components/ui/QuantitySelector"
import { useCart } from "@/hooks/useCartApi"
import useGetPassesData from "@/hooks/useGetPassesData"
import { usePurchasesQuery } from "@/hooks/useGetPurchases"
import { getPriceStrategy } from "@/strategies/PriceStrategy"
import { getProductStrategy } from "@/strategies/ProductStrategies"
import { getPurchaseStrategy } from "@/strategies/PurchaseStrategy"
import type { AttendeePassState } from "@/types/Attendee"
import type { ProductsPass } from "@/types/Products"
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
  /**
   * Attendees to drive the passes selection state off. Callers are
   * responsible for sorting — see `useResolvedAttendees` for the canonical
   * source that handles application vs direct-sale flows.
   */
  attendees: AttendeePassState[]
  restoreFromCart?: boolean
}

/**
 * Build a Map<attendeeId, ProductsPass[]> from the purchases query data.
 */
function buildPurchasesMap(
  purchasesData: AttendeePurchases[] | undefined,
): Map<string, ProductsPass[]> {
  const map = new Map<string, ProductsPass[]>()
  if (!purchasesData) return map

  for (const entry of purchasesData) {
    const products = (entry.products ?? []).map((p) => ({
      ...p,
      price: Number(p.price),
      compare_price: p.compare_price ? Number(p.compare_price) : null,
      category: p.category as string,
    })) as ProductsPass[]
    map.set(entry.attendee_id, products)
  }
  return map
}

/**
 * Builds the base attendeePasses structure from server data (attendees + products).
 * All products start with `selected: false`. Purchase rules and prices are applied.
 * Uses purchasesMap (from dedicated purchases endpoint) for purchased product state.
 */
function buildBaseAttendeePasses(
  attendees: AttendeePassState[],
  products: ProductsPass[],
  discountValue: number,
  purchasesMap: Map<string, ProductsPass[]>,
): AttendeePassState[] {
  const priceStrategy = getPriceStrategy()
  const purchaseStrategy = getPurchaseStrategy()

  return attendees.map((attendee) => {
    const purchased = purchasesMap.get(attendee.id) ?? []

    const hasPatreonPurchased = purchased.some((p) => p.category === "patreon")

    const attendeeProducts = products
      .filter(
        (product: ProductsPass) =>
          product.attendee_category === attendee.category && product.is_active,
      )
      .map((product: ProductsPass) => {
        const isMultiUnit =
          product.duration_type !== "day" &&
          supportsQuantitySelector(product.max_quantity)
        const originalQuantity =
          product.duration_type === "day"
            ? (purchased.find((p) => p.id === product.id)?.quantity ?? 0)
            : 1
        // Multi-unit non-day products start at 0 so the UI shows them as "empty";
        // single-unit non-day keep the legacy init of 1 so existing toggle code paths
        // multiply by 1 and downstream totals remain unchanged.
        const initialQuantity = isMultiUnit ? 0 : originalQuantity

        return {
          ...product,
          original_quantity: originalQuantity,
          quantity: initialQuantity,
          selected: false,
          attendee_id: attendee.id,
          original_price: product.price,
          disabled: false,
          price: priceStrategy.calculatePrice(
            product,
            hasPatreonPurchased,
            discountValue,
          ),
        }
      })

    return {
      ...attendee,
      products: purchaseStrategy.applyPurchaseRules(
        attendeeProducts,
        purchased,
      ),
    }
  })
}

/**
 * Applies saved cart selections onto already-built attendeePasses.
 * Mutates nothing — returns a new array.
 */
function applyCartSelections(
  attendeePasses: AttendeePassState[],
  cartPasses: { attendee_id: string; product_id: string; quantity: number }[],
): AttendeePassState[] {
  if (!cartPasses.length) return attendeePasses

  // Build a lookup for O(1) access
  const cartLookup = new Map<string, number>()
  for (const cp of cartPasses) {
    cartLookup.set(`${cp.attendee_id}:${cp.product_id}`, cp.quantity)
  }

  return attendeePasses.map((attendee) => ({
    ...attendee,
    products: attendee.products.map((product) => {
      const key = `${attendee.id}:${product.id}`
      const cartQuantity = cartLookup.get(key)
      if (cartQuantity === undefined) return product

      const isDayPass = product.duration_type === "day"
      if (isDayPass) {
        return {
          ...product,
          selected: true,
          quantity: (product.original_quantity ?? 0) + cartQuantity,
        }
      }
      // Non-day: multi-unit products restore the persisted quantity;
      // single-unit products stay at the legacy quantity of 1.
      const isMultiUnit = supportsQuantitySelector(product.max_quantity)
      return {
        ...product,
        selected: true,
        quantity: isMultiUnit ? cartQuantity : product.quantity,
      }
    }),
  }))
}

/**
 * Preserves existing selections when rebuilding attendeePasses
 * (e.g. when a new attendee is added or product list changes).
 */
function preserveSelections(
  newPasses: AttendeePassState[],
  existingPasses: AttendeePassState[],
): AttendeePassState[] {
  const existingLookup = new Map<string, Map<string, ProductsPass>>()
  for (const attendee of existingPasses) {
    const productMap = new Map<string, ProductsPass>()
    for (const product of attendee.products) {
      productMap.set(product.id, product)
    }
    existingLookup.set(attendee.id, productMap)
  }

  return newPasses.map((attendee) => {
    const existingProducts = existingLookup.get(attendee.id)
    if (!existingProducts) return attendee

    return {
      ...attendee,
      products: attendee.products.map((product) => {
        const existing = existingProducts.get(product.id)
        if (!existing) return product
        return {
          ...product,
          selected: existing.selected ?? false,
          quantity: existing.quantity ?? product.quantity,
          edit: existing.edit ?? false,
        }
      }),
    }
  })
}

const PassesProvider = ({
  children,
  attendees,
  restoreFromCart = false,
}: PassesProviderProps) => {
  const { discountApplied } = useDiscount()
  const [attendeePasses, setAttendeePasses] = useState<AttendeePassState[]>([])

  const [isEditing, setIsEditing] = useState(false)
  const { products } = useGetPassesData()
  const { getCity } = useCityProvider()
  const city = getCity()
  const cityId = city?.id ? String(city.id) : null
  const previousCityIdRef = useRef(cityId)
  const hasInitializedRef = useRef(false)
  const hasRestoredCartRef = useRef(false)
  const { data: savedCartPasses } = useCart(restoreFromCart ? cityId : null)

  // Dedicated purchases query — granular invalidation after payment
  const { data: purchasesData } = usePurchasesQuery(cityId)
  const purchasesMap = useMemo(
    () => buildPurchasesMap(purchasesData),
    [purchasesData],
  )

  // Refs for stable callback closures — avoids recreating toggleProduct on every discount/editing change
  const discountRef = useRef(discountApplied)
  discountRef.current = discountApplied
  const isEditingRef = useRef(isEditing)
  isEditingRef.current = isEditing

  // Track previous values for change detection
  const prevDiscountValueRef = useRef(discountApplied.discount_value)
  const prevAttendeesRef = useRef(attendees)
  const prevProductsRef = useRef(products)
  const prevPurchasesMapRef = useRef(purchasesMap)

  // Reset when city changes so stale data doesn't persist
  useEffect(() => {
    if (previousCityIdRef.current === cityId) return
    previousCityIdRef.current = cityId
    setAttendeePasses([])
    hasInitializedRef.current = false
    hasRestoredCartRef.current = false
    setIsEditing(false)
  }, [cityId])

  // Stable toggleProduct — reads discount & editing from refs, never recreated
  const toggleProduct = useCallback(
    (attendeeId: string, product: ProductsPass) => {
      if (!product) return
      const strategy = getProductStrategy(product, isEditingRef.current)
      setAttendeePasses((current) =>
        strategy.handleSelection(
          current,
          attendeeId,
          product,
          discountRef.current,
        ),
      )
    },
    [],
  )

  // Ref to read savedCartPasses inside init effect without it being a dep
  const savedCartPassesRef = useRef(savedCartPasses)
  savedCartPassesRef.current = savedCartPasses

  // Main effect: handles initialization, structural changes, and discount-only price recalculation.
  // savedCartPasses is read from ref (not a dep) to avoid re-running when cart is saved during checkout.
  useEffect(() => {
    if (attendees.length === 0 || products.length === 0) return

    const discountValue = discountApplied.discount_value
    const discountChanged = discountValue !== prevDiscountValueRef.current
    const structuralChange =
      attendees !== prevAttendeesRef.current ||
      products !== prevProductsRef.current ||
      purchasesMap !== prevPurchasesMapRef.current

    prevDiscountValueRef.current = discountValue
    prevAttendeesRef.current = attendees
    prevProductsRef.current = products
    prevPurchasesMapRef.current = purchasesMap

    if (!hasInitializedRef.current) {
      // First initialization — build base passes with prices
      let basePasses = buildBaseAttendeePasses(
        attendees,
        products,
        discountValue,
        purchasesMap,
      )

      // Apply cart selections in the same tick if already available (avoids extra render cycle)
      const cart = savedCartPassesRef.current
      if (
        restoreFromCart &&
        !hasRestoredCartRef.current &&
        cart?.passes?.length
      ) {
        hasRestoredCartRef.current = true
        basePasses = applyCartSelections(basePasses, cart.passes)
      }

      hasInitializedRef.current = true
      setAttendeePasses(basePasses)
      return
    }

    // Structural change (attendees/products/purchases changed) — rebuild with current discount
    if (structuralChange) {
      const basePasses = buildBaseAttendeePasses(
        attendees,
        products,
        discountValue,
        purchasesMap,
      )
      setAttendeePasses((current) => preserveSelections(basePasses, current))
      return
    }

    // Discount-only change — recalculate prices without rebuilding structure
    if (discountChanged) {
      const priceStrategy = getPriceStrategy()
      setAttendeePasses((current) =>
        current.map((attendee) => {
          const hasPatreonPurchased = attendee.products.some(
            (p) => p.category === "patreon" && p.purchased,
          )
          return {
            ...attendee,
            products: attendee.products.map((product) => ({
              ...product,
              price: priceStrategy.calculatePrice(
                { ...product, price: product.original_price ?? product.price },
                hasPatreonPurchased,
                discountValue,
              ),
            })),
          }
        }),
      )
    }
  }, [
    attendees,
    products,
    purchasesMap,
    discountApplied.discount_value,
    restoreFromCart,
  ])

  // Cart restoration for late-arriving cart data (cart loads after initialization)
  useEffect(() => {
    if (!restoreFromCart) return
    if (hasRestoredCartRef.current) return
    if (!hasInitializedRef.current) return
    if (attendeePasses.length === 0) return
    if (!savedCartPasses?.passes?.length) return

    hasRestoredCartRef.current = true
    setAttendeePasses((current) =>
      applyCartSelections(current, savedCartPasses.passes),
    )
  }, [restoreFromCart, attendeePasses.length, savedCartPasses])

  const toggleEditing = useCallback((editing?: boolean) => {
    setAttendeePasses((current) =>
      current.map((attendee) => ({
        ...attendee,
        products: attendee.products.map((product) => ({
          ...product,
          edit: false,
          selected: false,
          disabled: false,
        })),
      })),
    )

    setIsEditing((prev) => (editing !== undefined ? editing : !prev))
  }, [])

  const contextValue = useMemo(
    () => ({
      attendeePasses,
      toggleProduct,
      products,
      isEditing,
      toggleEditing,
    }),
    [attendeePasses, toggleProduct, products, isEditing, toggleEditing],
  )

  return (
    <PassesContext.Provider value={contextValue}>
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
