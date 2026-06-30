/**
 * useTicketsStep — unified tickets business logic contract.
 *
 * A thin consolidating wrapper over the existing providers. It does NOT
 * introduce a third source of truth: state stays in passesProvider
 * (pass_system) and checkoutProvider.dynamicItems (simple_quantity).
 *
 * The hook normalizes both paths into a single TicketsStepView shape and
 * routes actions to the correct underlying model. Skins (VariantTicketSelect,
 * VariantTicketCard) become pure presentation reading that shape.
 */

import { useMemo } from "react"
import {
  CHECKOUT_MODE,
  resolvePopupCheckoutPolicy,
} from "@/checkout/popupCheckoutPolicy"
import { deriveProductState } from "@/lib/product-state"
import { useCheckout } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import { isPassQuantityBased } from "@/strategies/passQuantityHelper"
import type { AttendeePassState } from "@/types/Attendee"
import type { SelectedDynamicItem } from "@/types/checkout"
import type { ProductsPass } from "@/types/Products"
import type { TemplateSection } from "./ticketSections"
import { buildSectionGroups, parseSections } from "./ticketSections"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type TicketsMode = "pass_system" | "simple_quantity"

export interface TicketRowVM {
  product: ProductsPass
  selected: boolean
  purchased: boolean
  /** True when the product is purchased, isEditing is active, and product.edit=true */
  editedForCredit: boolean
  /** Precomputed: exclusivity + sale-state + stock. Skins never recompute this. */
  disabled: boolean
  quantity: number
  maxQuantity: number
  usesStepper: boolean
  price: number
  comparePrice: number | null
}

export interface TicketSectionVM {
  key: string
  label: string
  image_url?: string
  image_aspect?: string
  description?: string
  rows: TicketRowVM[]
}

export interface TicketAttendeeVM {
  id: string
  name: string
  category: string
  category_id: string | null
  sections: TicketSectionVM[]
  selectedCount: number
}

export interface TicketsStepView {
  mode: TicketsMode
  /** True when no real attendees exist and the active path is simple_quantity */
  isOpenCheckout: boolean
  /** pass_system: real attendees; simple_quantity: single synthetic bucket */
  attendees: TicketAttendeeVM[]
  /** Flat sections for open-checkout rendering (no attendee axis) */
  sections: TicketSectionVM[]
  isEditing: boolean
  editCredit: number
  toggleRow: (attendeeId: string, product: ProductsPass) => void
  setRowQuantity: (
    attendeeId: string,
    product: ProductsPass,
    qty: number,
  ) => void
  toggleEditing: (editing?: boolean) => void
}

// ---------------------------------------------------------------------------
// Hook args
// ---------------------------------------------------------------------------

export interface UseTicketsStepArgs {
  stepType: string
  templateConfig: Record<string, unknown> | null | undefined
  products: ProductsPass[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function supportsQuantitySelectorLocal(
  maxPerOrder: number | null | undefined,
): boolean {
  return maxPerOrder === null || (maxPerOrder !== undefined && maxPerOrder > 1)
}

function resolveMaxQuantityLocal(product: ProductsPass): number {
  const { max_per_order, total_stock_remaining } = product as ProductsPass & {
    total_stock_remaining?: number | null
  }
  const fromMax = max_per_order === null ? 99 : (max_per_order ?? 1)
  if (total_stock_remaining != null && total_stock_remaining < fromMax) {
    return total_stock_remaining
  }
  return fromMax
}

function buildRowVM(
  product: ProductsPass,
  hasFullOrMonthSelected: boolean,
  isEditing: boolean,
): TicketRowVM {
  const saleState = deriveProductState(product)
  const stateBlocked = saleState !== "on_sale"

  const isWeekOrDay =
    product.duration_type === "week" || product.duration_type === "day"

  const disabled =
    !!product.disabled ||
    stateBlocked ||
    (isWeekOrDay && hasFullOrMonthSelected && !product.purchased)

  // In pass_system, full/month passes are single-select (not quantity-based)
  // even when max_per_order is null. Use the shared helper so this stays
  // consistent with the strategy layer.
  const usesStepper = isPassQuantityBased(product)

  return {
    product,
    selected: product.selected ?? false,
    purchased: product.purchased ?? false,
    editedForCredit: !!(product.purchased && isEditing && product.edit),
    disabled,
    quantity: product.quantity ?? (usesStepper ? 0 : 1),
    maxQuantity: resolveMaxQuantityLocal(product),
    usesStepper,
    price: product.price,
    comparePrice: product.compare_price ?? null,
  }
}

function buildSectionVMs(
  attendee: AttendeePassState,
  sections: TemplateSection[],
  hasFullOrMonthSelected: boolean,
  isEditing: boolean,
): TicketSectionVM[] {
  const groups = buildSectionGroups(attendee, sections)
  return groups.map(({ section, products }) => ({
    key: section.key,
    label: section.label,
    rows: products.map((p) => buildRowVM(p, hasFullOrMonthSelected, isEditing)),
  }))
}

function buildAttendeeVM(
  attendee: AttendeePassState,
  sections: TemplateSection[],
  isEditing: boolean,
): TicketAttendeeVM {
  const hasFullOrMonthSelected = attendee.products.some(
    (p) =>
      (p.duration_type === "full" || p.duration_type === "month") &&
      (p.purchased || p.selected),
  )

  const sectionVMs = buildSectionVMs(
    attendee,
    sections,
    hasFullOrMonthSelected,
    isEditing,
  )
  const selectedCount = attendee.products.filter(
    (p) => p.selected || p.purchased,
  ).length

  return {
    id: attendee.id,
    name: attendee.name ?? "",
    category: attendee.category ?? "",
    category_id: attendee.category_id ?? null,
    sections: sectionVMs,
    selectedCount,
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useTicketsStep({
  stepType,
  templateConfig,
  products: _products,
}: UseTicketsStepArgs): TicketsStepView {
  const {
    attendeePasses,
    toggleProduct,
    isEditing: passesIsEditing,
    toggleEditing,
  } = usePassesProvider()

  const {
    editCredit,
    isEditing: checkoutIsEditing,
    cart,
    addDynamicItem,
    removeDynamicItem,
    updateDynamicQuantity,
  } = useCheckout()

  const { getCity } = useCityProvider()
  const city = getCity()
  const checkoutPolicy = resolvePopupCheckoutPolicy(city)
  const checkoutMode = checkoutPolicy.checkoutMode

  // Merge isEditing from both sources — passesProvider is authoritative for
  // pass_system; checkoutProvider exposes the same value for consumers that
  // don't use passesProvider directly.
  const isEditing = passesIsEditing || checkoutIsEditing

  const parsedSections = useMemo(
    () => parseSections(templateConfig),
    [templateConfig],
  )

  // ---------------------------------------------------------------------------
  // pass_system branch
  // ---------------------------------------------------------------------------

  const attendeeVMs = useMemo(() => {
    if (checkoutMode !== CHECKOUT_MODE.PASS_SYSTEM) return []
    return attendeePasses.map((attendee) =>
      buildAttendeeVM(attendee, parsedSections, isEditing),
    )
  }, [attendeePasses, parsedSections, isEditing, checkoutMode])

  // isOpenCheckout: the popup is configured for simple_quantity mode.
  // OpenCheckoutRuntime always injects a virtual buyer attendee into PassesProvider,
  // so we cannot rely on attendeePasses.length === 0 to detect open checkout — that
  // check was the Slice 3 regression on amanita (ticket-card showed empty state).
  // The authoritative signal is the popup-level checkout mode, not attendee presence.
  const isOpenCheckout = checkoutMode === CHECKOUT_MODE.SIMPLE_QUANTITY

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const toggleRow = useMemo(
    () => (attendeeId: string, product: ProductsPass) => {
      if (checkoutMode === CHECKOUT_MODE.PASS_SYSTEM) {
        // Resolve section scope for the attendee so the strategy can apply
        // exclusivity and auto-promotion correctly.
        const attendee = attendeePasses.find((a) => a.id === attendeeId)
        if (!attendee) return

        const groups = buildSectionGroups(attendee, parsedSections)
        const sectionForProduct = groups.find((g) =>
          g.products.some((p) => p.id === product.id),
        )
        const scopeIds = sectionForProduct?.products.map((p) => p.id)
        const attendeeVisibleProductIds = groups.flatMap((g) =>
          g.products.map((p) => p.id),
        )

        toggleProduct(attendeeId, product, scopeIds, attendeeVisibleProductIds)
        return
      }

      // simple_quantity / open-checkout: delegate to checkoutProvider.dynamicItems
      const items = cart.dynamicItems[stepType] ?? []
      const existing = items.find((i) => i.productId === product.id)
      if (existing) {
        removeDynamicItem(stepType, product.id)
      } else {
        const item: SelectedDynamicItem = {
          productId: product.id,
          product,
          quantity: 1,
          price: product.price,
          stepType,
        }
        addDynamicItem(stepType, item)
      }
    },
    [
      checkoutMode,
      attendeePasses,
      parsedSections,
      toggleProduct,
      cart,
      stepType,
      addDynamicItem,
      removeDynamicItem,
    ],
  )

  const setRowQuantity = useMemo(
    () => (attendeeId: string, product: ProductsPass, qty: number) => {
      if (checkoutMode === CHECKOUT_MODE.PASS_SYSTEM) {
        const attendee = attendeePasses.find((a) => a.id === attendeeId)
        if (!attendee) return

        const groups = buildSectionGroups(attendee, parsedSections)
        const sectionForProduct = groups.find((g) =>
          g.products.some((p) => p.id === product.id),
        )
        const scopeIds = sectionForProduct?.products.map((p) => p.id)
        const attendeeVisibleProductIds = groups.flatMap((g) =>
          g.products.map((p) => p.id),
        )

        toggleProduct(
          attendeeId,
          { ...product, quantity: qty },
          scopeIds,
          attendeeVisibleProductIds,
        )
        return
      }

      // simple_quantity / open-checkout: route quantity updates through dynamicItems
      if (qty <= 0) {
        removeDynamicItem(stepType, product.id)
        return
      }
      updateDynamicQuantity(stepType, product.id, qty)
    },
    [
      checkoutMode,
      attendeePasses,
      parsedSections,
      toggleProduct,
      stepType,
      removeDynamicItem,
      updateDynamicQuantity,
    ],
  )

  // ---------------------------------------------------------------------------
  // simple_quantity branch — synthetic VM bucket
  // ---------------------------------------------------------------------------

  const openCheckoutVMs = useMemo(() => {
    if (!isOpenCheckout)
      return {
        attendees: [] as TicketAttendeeVM[],
        sections: [] as TicketSectionVM[],
      }

    // Build a synthetic AttendeePassState so buildSectionGroups can run with
    // the products array. attendeePasses[0] is absent (open checkout), so we
    // synthesize one with id="" and category_id=null (no category filtering).
    const syntheticAttendee: AttendeePassState = {
      id: "",
      name: "",
      category: "main",
      category_id: null,
      tenant_id: "",
      popup_id: "",
      human_id: "",
      application_id: null,
      email: "",
      gender: null,
      poap_url: null,
      created_at: null,
      updated_at: null,
      products: _products,
    }

    // Re-read dynamicItems inline so quantity rows reflect cart state.
    // We must capture cart at render time for memoization to be correct.
    const items = cart.dynamicItems[stepType] ?? []
    const getQty = (productId: string) =>
      items.find((i) => i.productId === productId)?.quantity ?? 0

    const groups = buildSectionGroups(syntheticAttendee, parsedSections)
    const sectionVMs: TicketSectionVM[] = groups.map(
      ({ section, products: sectionProducts }) => ({
        key: section.key,
        label: section.label,
        rows: sectionProducts.map((p) => {
          const qty = getQty(p.id)
          const usesStepper = supportsQuantitySelectorLocal(p.max_per_order)
          return {
            product: p,
            selected: qty > 0,
            purchased: false,
            editedForCredit: false,
            disabled: !!p.disabled,
            quantity: qty,
            maxQuantity: resolveMaxQuantityLocal(p),
            usesStepper,
            price: p.price,
            comparePrice: p.compare_price ?? null,
          }
        }),
      }),
    )

    const syntheticAttendeeVM: TicketAttendeeVM = {
      id: "",
      name: "",
      category: "main",
      category_id: null,
      sections: sectionVMs,
      selectedCount: sectionVMs.reduce(
        (acc, s) => acc + s.rows.filter((r) => r.selected).length,
        0,
      ),
    }

    return { attendees: [syntheticAttendeeVM], sections: sectionVMs }
  }, [isOpenCheckout, _products, parsedSections, cart, stepType])

  // ---------------------------------------------------------------------------
  // View
  // ---------------------------------------------------------------------------

  const mode: TicketsMode =
    checkoutMode === CHECKOUT_MODE.PASS_SYSTEM
      ? "pass_system"
      : "simple_quantity"

  return {
    mode,
    isOpenCheckout,
    attendees: isOpenCheckout ? openCheckoutVMs.attendees : attendeeVMs,
    sections: openCheckoutVMs.sections,
    isEditing,
    editCredit,
    toggleRow,
    setRowQuantity,
    toggleEditing,
  }
}
