import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react"
import type { AttendeePurchases } from "@/client"
import { sortAttendees } from "@/helpers/filters"
import { useCart } from "@/hooks/useCartApi"
import useGetPassesData from "@/hooks/useGetPassesData"
import { usePurchasesQuery } from "@/hooks/useGetPurchases"
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
        const originalQuantity =
          product.duration_type === "day"
            ? (purchased.find((p) => p.id === product.id)?.quantity ?? 0)
            : 1

        return {
          ...product,
          original_quantity: originalQuantity,
          quantity: originalQuantity,
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
      return {
        ...product,
        selected: true,
        quantity: isDayPass
          ? (product.original_quantity ?? 0) + cartQuantity
          : product.quantity,
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
  restoreFromCart = false,
}: PassesProviderProps) => {
  const { getAttendees } = useApplication()
  const { discountApplied } = useDiscount()
  const [attendeePasses, setAttendeePasses] = useState<AttendeePassState[]>([])

  const attendees = sortAttendees(getAttendees())

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
  const purchasesMap = buildPurchasesMap(purchasesData)

  // Track attendee/product counts to detect structural changes
  const prevAttendeeCountRef = useRef(0)
  const prevProductCountRef = useRef(0)
  const prevPurchasesDataRef = useRef(purchasesData)

  // Reset when city changes so stale data doesn't persist
  useEffect(() => {
    if (previousCityIdRef.current === cityId) return
    previousCityIdRef.current = cityId
    setAttendeePasses([])
    hasInitializedRef.current = false
    hasRestoredCartRef.current = false
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

  // Step 1: Initialize attendeePasses from server data (one-time)
  // Re-runs when attendee/product counts or purchases data changes
  useEffect(() => {
    if (attendees.length === 0 || products.length === 0) return

    const attendeeCountChanged =
      attendees.length !== prevAttendeeCountRef.current
    const productCountChanged = products.length !== prevProductCountRef.current
    const purchasesChanged = purchasesData !== prevPurchasesDataRef.current
    const structuralChange =
      attendeeCountChanged || productCountChanged || purchasesChanged

    prevAttendeeCountRef.current = attendees.length
    prevProductCountRef.current = products.length
    prevPurchasesDataRef.current = purchasesData

    if (!hasInitializedRef.current) {
      // First initialization
      const basePasses = buildBaseAttendeePasses(
        attendees,
        products,
        discountApplied.discount_value,
        purchasesMap,
      )
      hasInitializedRef.current = true
      setAttendeePasses(basePasses)
    } else if (structuralChange) {
      // Structural change (new attendee, product change, or purchase completed)
      // Rebuild but preserve existing selections
      const basePasses = buildBaseAttendeePasses(
        attendees,
        products,
        discountApplied.discount_value,
        purchasesMap,
      )
      setAttendeePasses((current) => preserveSelections(basePasses, current))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    attendees,
    products,
    discountApplied.discount_value,
    purchasesData,
    purchasesMap,
  ])

  // Step 2: Apply cart selections (one-time, after initialization)
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

  // Step 3: Recalculate prices when discount changes (without losing selections)
  useEffect(() => {
    if (!hasInitializedRef.current) return
    if (attendeePasses.length === 0) return

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
              discountApplied.discount_value,
            ),
          })),
        }
      }),
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [discountApplied, attendeePasses.length])

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
