"use client"

import { motion } from "framer-motion"
import {
  Baby,
  Check,
  Clock,
  Heart,
  Layers,
  Minus,
  Plus,
  Sparkles,
  Ticket,
  User,
} from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { badgeName } from "@/app/portal/[popupSlug]/passes/constants/multiuse"
import {
  getPassSelectionLayout,
  shouldDisableForPrimaryRestriction,
} from "@/checkout/passSelectionUi"
import {
  CHECKOUT_MODE,
  resolvePopupCheckoutPolicy,
} from "@/checkout/popupCheckoutPolicy"
import AddAttendeeButtons from "@/components/checkout-flow/shared/AddAttendeeButtons"
import {
  resolveMaxQuantity,
  supportsQuantitySelector,
} from "@/components/ui/QuantitySelector"
import { formatDate } from "@/helpers/dates"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import type { TierGroupPublic } from "@/client"
import type { AttendeeCategory, AttendeePassState } from "@/types/Attendee"
import type { ProductsPass } from "@/types/Products"

/** Smooth-scroll to an attendee card. Defers one frame so layout settles first. */
function scrollToAttendeeCard(attendeeId: string) {
  requestAnimationFrame(() => {
    const el = document.getElementById(`attendee-card-${attendeeId}`)
    el?.scrollIntoView({ behavior: "smooth", block: "center" })
  })
}

const CATEGORY_ORDER = ["main", "spouse", "kid", "teen", "baby"]

const getCategoryLabel = (category: AttendeeCategory): string => {
  return badgeName[category] || category
}

const getCategoryGroupLabel = (category: string): string => {
  if (category === "main") return "Primary Attendee"
  if (category === "spouse") return "Spouse"
  if (category === "kid" || category === "teen" || category === "baby")
    return "Family Members"
  return getCategoryLabel(category as AttendeeCategory)
}

const getCategoryIcon = (category: string) => {
  if (category === "main") return User
  if (category === "spouse") return Heart
  return Baby
}

const getCategoryColors = (category: string) => {
  if (category === "main")
    return {
      header: "bg-gray-900 text-white",
      accent: "border-gray-900",
      tab: "text-gray-900 border-gray-900",
      badge: "bg-gray-100 text-gray-800",
      icon: "text-white",
    }
  if (category === "spouse")
    return {
      header: "bg-indigo-600 text-white",
      accent: "border-indigo-600",
      tab: "text-indigo-600 border-indigo-600",
      badge: "bg-indigo-50 text-indigo-700",
      icon: "text-white",
    }
  return {
    header: "bg-amber-500 text-white",
    accent: "border-amber-500",
    tab: "text-amber-600 border-amber-500",
    badge: "bg-amber-50 text-amber-700",
    icon: "text-white",
  }
}

const sortProductsByPriority = (a: ProductsPass, b: ProductsPass): number => {
  const getPriority = (p: ProductsPass) => {
    const dt = p.duration_type
    if (dt === "full") return 0
    if (dt === "month") return 1
    if (dt === "week") return 2
    if (dt === "day") return 3
    return 4
  }
  return getPriority(a) - getPriority(b)
}

const stripedPatternStyle = {
  backgroundImage:
    "repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(0,0,0,0.07) 3px, rgba(0,0,0,0.07) 6px)",
}

export default function PassSelectionSection() {
  const { attendeePasses, toggleProduct, isEditing } = usePassesProvider()
  const { editCredit } = useCheckout()
  const { getCity } = useCityProvider()
  const policy = resolvePopupCheckoutPolicy(getCity())
  const [focusedAttendeeId, setFocusedAttendeeId] = useState<string | null>(
    null,
  )

  const groupedByCategory = useMemo(() => {
    const map = new Map<string, AttendeePassState[]>()
    for (const a of attendeePasses) {
      const cat = a.category
      if (!map.has(cat)) map.set(cat, [])
      map.get(cat)!.push(a)
    }
    return [...map.entries()].sort(
      ([a], [b]) => CATEGORY_ORDER.indexOf(a) - CATEGORY_ORDER.indexOf(b),
    )
  }, [attendeePasses])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="space-y-3"
    >
      {/* Edit Mode Banner */}
      {isEditing && (
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-primary/30 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-primary">Edit Mode</p>
              <p className="text-sm text-primary">
                Click on a purchased pass to get credit, then select a new pass.
              </p>
            </div>
            {editCredit > 0 && (
              <div className="bg-primary/20 px-3 py-1.5 rounded-lg">
                <p className="text-sm font-semibold text-primary">
                  Credit: ${editCredit.toLocaleString()}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toolbar: Add Family Members */}
      {!isEditing && (
        <AddAttendeeButtons onAttendeeAdded={setFocusedAttendeeId} />
      )}

      {getPassSelectionLayout(policy.checkoutMode) === "flat" ? (
        <SimpleQuantityVariant
          attendees={attendeePasses}
          toggleProduct={toggleProduct}
          isEditing={isEditing}
          focusedAttendeeId={focusedAttendeeId}
        />
      ) : (
        <StackedVariant
          groupedByCategory={groupedByCategory}
          allAttendees={attendeePasses}
          toggleProduct={toggleProduct}
          isEditing={isEditing}
          focusedAttendeeId={focusedAttendeeId}
        />
      )}
    </motion.div>
  )
}

// ---------------------------------------------------------------------------
// Shared variant props
// ---------------------------------------------------------------------------

interface VariantProps {
  groupedByCategory: [string, AttendeePassState[]][]
  allAttendees: AttendeePassState[]
  toggleProduct: (attendeeId: string, product: ProductsPass) => void
  isEditing: boolean
  focusedAttendeeId?: string | null
}

function SimpleQuantityVariant({
  attendees,
  toggleProduct,
  isEditing,
  focusedAttendeeId,
}: {
  attendees: AttendeePassState[]
  toggleProduct: (attendeeId: string, product: ProductsPass) => void
  isEditing: boolean
  focusedAttendeeId?: string | null
}) {
  useEffect(() => {
    if (focusedAttendeeId) scrollToAttendeeCard(focusedAttendeeId)
  }, [focusedAttendeeId])

  return (
    <div className="space-y-3">
      {attendees.map((attendee) => {
        const allStandardProducts = attendee.products
          .filter((product) => product.category !== "patreon")
          .sort(sortProductsByPriority)

        const { groups: tierGroups, ungrouped } =
          partitionByTierGroup(allStandardProducts)

        return (
          <div
            key={attendee.id}
            id={`attendee-card-${attendee.id}`}
            className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
          >
            <div className="border-b border-border bg-muted px-5 py-3">
              <p className="text-sm font-semibold text-foreground">
                {attendee.name}
              </p>
              <p className="text-xs text-muted-foreground">
                Choose quantities directly. No attendee pass dependencies apply
                in this checkout mode.
              </p>
            </div>

            {/* Tier group cards */}
            {tierGroups.size > 0 && (
              <div className="px-4 py-3 space-y-2">
                {[...tierGroups.values()].map(
                  ({ group, products: groupProducts }) => (
                    <TierGroupCard
                      key={group.id}
                      group={group}
                      products={groupProducts}
                      attendeeId={attendee.id}
                      toggleProduct={toggleProduct}
                      isEditing={isEditing}
                    />
                  ),
                )}
              </div>
            )}

            {/* Ungrouped products */}
            <div className="divide-y divide-border">
              {ungrouped.map((product) => {
                const usesQuantity =
                  product.duration_type === "day" ||
                  supportsQuantitySelector(product.max_quantity)

                if (usesQuantity) {
                  return (
                    <QuantityPassOption
                      key={product.id}
                      product={product}
                      onQuantityChange={(quantity) =>
                        toggleProduct(attendee.id, { ...product, quantity })
                      }
                      isEditing={isEditing}
                    />
                  )
                }

                return (
                  <PassOption
                    key={product.id}
                    product={product}
                    onClick={() => toggleProduct(attendee.id, product)}
                    isEditing={isEditing}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// StackedVariant — one card per category, visually distinct headers
// ---------------------------------------------------------------------------

function StackedVariant({
  groupedByCategory,
  allAttendees,
  toggleProduct,
  isEditing,
  focusedAttendeeId,
}: VariantProps) {
  useEffect(() => {
    if (focusedAttendeeId) scrollToAttendeeCard(focusedAttendeeId)
  }, [focusedAttendeeId])

  return (
    <div className="space-y-3">
      {groupedByCategory.map(([category, attendees]) => {
        const colors = getCategoryColors(category)
        const Icon = getCategoryIcon(category)
        const groupLabel = getCategoryGroupLabel(category)

        return (
          <div
            key={category}
            className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden"
          >
            {/* Category Header */}
            <div className={cn("px-5 py-3", colors.header)}>
              <div className="flex items-center gap-2.5">
                <Icon className={cn("w-4 h-4", colors.icon)} />
                <span className="font-semibold text-sm">{groupLabel}</span>
                {attendees.length > 1 && (
                  <span className="ml-auto text-xs opacity-70">
                    {attendees.length} members
                  </span>
                )}
              </div>
            </div>

            {/* Attendees within this category */}
            {attendees.map((attendee, idx) => (
              <div key={attendee.id} id={`attendee-card-${attendee.id}`}>
                {attendees.length > 1 && (
                  <div className="px-5 py-2 bg-muted border-b border-border flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">
                      {attendee.name}
                    </span>
                  </div>
                )}
                <AttendeePassCardBody
                  attendee={attendee}
                  toggleProduct={toggleProduct}
                  isEditing={isEditing}
                  allAttendees={allAttendees}
                />
                {idx < attendees.length - 1 && (
                  <div className="h-px bg-border mx-5" />
                )}
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tier group utilities
// ---------------------------------------------------------------------------

/**
 * Groups products by their tier_group.id.
 * Returns an ordered map of groupId → { group, phases sorted by order }.
 * Products without a tier_group are collected into the `ungrouped` bucket.
 */
function partitionByTierGroup(products: ProductsPass[]): {
  groups: Map<string, { group: TierGroupPublic; products: ProductsPass[] }>
  ungrouped: ProductsPass[]
} {
  const groups = new Map<
    string,
    { group: TierGroupPublic; products: ProductsPass[] }
  >()
  const ungrouped: ProductsPass[] = []

  for (const product of products) {
    if (product.tier_group) {
      const existing = groups.get(product.tier_group.id)
      if (existing) {
        existing.products.push(product)
      } else {
        groups.set(product.tier_group.id, {
          group: product.tier_group,
          products: [product],
        })
      }
    } else {
      ungrouped.push(product)
    }
  }

  // Sort each group's products by phase.order ascending
  for (const entry of groups.values()) {
    entry.products.sort((a, b) => (a.phase?.order ?? 0) - (b.phase?.order ?? 0))
  }

  return { groups, ungrouped }
}

// ---------------------------------------------------------------------------
// TierGroupCard — renders one card per tier group with all phases as sub-rows
// ---------------------------------------------------------------------------

interface TierGroupCardProps {
  group: TierGroupPublic
  products: ProductsPass[]
  attendeeId: string
  toggleProduct: (attendeeId: string, product: ProductsPass) => void
  isEditing: boolean
}

function TierGroupCard({
  group,
  products,
  attendeeId,
  toggleProduct,
  isEditing,
}: TierGroupCardProps) {
  return (
    <div
      data-testid="tier-group-card"
      className="overflow-hidden rounded-xl border border-border bg-card shadow-sm"
    >
      {/* Group header */}
      <div className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-violet-50 to-indigo-50 border-b border-border">
        <Layers className="w-4 h-4 text-violet-500" />
        <span className="text-xs font-semibold text-violet-700 uppercase tracking-wide">
          {group.name}
        </span>
        {group.shared_stock_remaining != null && (
          <span className="ml-auto text-xs text-muted-foreground">
            {group.shared_stock_remaining} remaining
          </span>
        )}
      </div>

      {/* Phase rows */}
      <div className="divide-y divide-border">
        {products.map((product) => (
          <TierPhaseRow
            key={product.id}
            product={product}
            attendeeId={attendeeId}
            toggleProduct={toggleProduct}
            isEditing={isEditing}
          />
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// TierPhaseRow — one row per phase within a tier group card
// ---------------------------------------------------------------------------

interface TierPhaseRowProps {
  product: ProductsPass
  attendeeId: string
  toggleProduct: (attendeeId: string, product: ProductsPass) => void
  isEditing: boolean
}

function TierPhaseRow({
  product,
  attendeeId,
  toggleProduct,
  isEditing,
}: TierPhaseRowProps) {
  const phase = product.phase
  const salesState = phase?.sales_state ?? "available"
  const isPurchasable = phase?.is_purchasable ?? true
  const { selected, purchased } = product

  const isAvailable = salesState === "available" && isPurchasable
  const isUpcoming = salesState === "upcoming"
  const isInactive = salesState === "sold_out" || salesState === "expired"

  const label = phase?.label ?? product.name
  const order = phase?.order ?? 0

  return (
    <div
      data-testid={`tier-phase-row-${product.id}`}
      data-phase-state={salesState}
      data-phase-order={String(order)}
      className={cn(
        "px-4 py-3 flex items-center justify-between gap-4",
        isInactive ? "opacity-50 bg-muted/30" : "",
        isUpcoming ? "bg-blue-50/50" : "",
        isAvailable && selected ? "bg-primary/5" : "",
      )}
    >
      {/* Left: phase label + meta */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Ticket
            className={cn(
              "w-4 h-4 shrink-0",
              isInactive
                ? "text-muted-foreground/50"
                : isUpcoming
                  ? "text-blue-400"
                  : "text-muted-foreground",
            )}
          />
          <span
            className={cn(
              "font-medium text-sm",
              isInactive ? "text-muted-foreground" : "text-foreground",
            )}
          >
            {label}
          </span>
          {salesState === "sold_out" && (
            <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-red-100 text-red-600 rounded tracking-wide">
              Sold out
            </span>
          )}
          {salesState === "expired" && (
            <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-gray-100 text-gray-500 rounded tracking-wide">
              Ended
            </span>
          )}
          {isUpcoming && (
            <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-blue-100 text-blue-600 rounded tracking-wide">
              Soon
            </span>
          )}
          {purchased && !isEditing && (
            <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase bg-slate-100 text-slate-500 border border-slate-200 rounded tracking-wide">
              Owned
            </span>
          )}
        </div>

        {/* Date range for upcoming phases */}
        {isUpcoming && phase?.sale_starts_at && (
          <div
            data-testid={`tier-phase-date-${product.id}`}
            className="flex items-center gap-1 mt-1 ml-6 text-xs text-blue-500"
          >
            <Clock className="w-3 h-3" />
            <span>
              Opens{" "}
              {formatDate(phase.sale_starts_at, {
                day: "numeric",
                month: "short",
              })}
            </span>
          </div>
        )}
      </div>

      {/* Right: price + CTA */}
      <div className="flex items-center gap-3 shrink-0">
        <p
          className={cn(
            "text-sm font-semibold",
            isInactive ? "text-muted-foreground" : "text-foreground",
          )}
        >
          ${product.price.toLocaleString()}
        </p>

        {isAvailable && !purchased && (
          <button
            type="button"
            data-testid={`tier-phase-cta-${product.id}`}
            onClick={() => toggleProduct(attendeeId, product)}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
              selected
                ? "bg-primary text-primary-foreground"
                : "bg-primary/10 text-primary hover:bg-primary/20",
            )}
          >
            {selected ? "Selected" : "Select"}
          </button>
        )}

        {isAvailable && purchased && isEditing && (
          <button
            type="button"
            data-testid={`tier-phase-cta-${product.id}`}
            onClick={() => toggleProduct(attendeeId, product)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-100 text-orange-700 hover:bg-orange-200 transition-all"
          >
            {product.edit ? "Undo" : "Exchange"}
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AttendeePassCardBody — shared pass list body for the legacy stacked layout
// ---------------------------------------------------------------------------

interface AttendeePassCardBodyProps {
  attendee: AttendeePassState
  toggleProduct: (attendeeId: string, product: ProductsPass) => void
  isEditing: boolean
  allAttendees: AttendeePassState[]
}

function AttendeePassCardBody({
  attendee,
  toggleProduct,
  isEditing,
  allAttendees,
}: AttendeePassCardBodyProps) {
  const isChild =
    attendee.category === "kid" ||
    attendee.category === "teen" ||
    attendee.category === "baby"

  const allStandardProducts = attendee.products
    .filter((product) => product.category !== "patreon")
    .sort(sortProductsByPriority)

  // Partition into tier-grouped and ungrouped
  const { groups: tierGroups, ungrouped } = partitionByTierGroup(allStandardProducts)

  // Ungrouped products use the legacy layout by duration_type
  const standardProducts = ungrouped

  const fullProducts = standardProducts.filter(
    (p) => p.duration_type === "full",
  )
  const monthProducts = standardProducts.filter(
    (p) => p.duration_type === "month",
  )
  const weekProducts = standardProducts.filter(
    (p) => p.duration_type === "week",
  )
  const dayProducts = standardProducts.filter((p) => p.duration_type === "day")

  const hasFullOrMonthSelected = attendee.products.some(
    (p) =>
      (p.duration_type === "full" || p.duration_type === "month") &&
      (p.purchased || p.selected),
  )

  const primaryHasPass = (passId: string): boolean => {
    const primary = allAttendees.find((a) => a.category === "main")
    if (!primary) return true
    const primaryProduct = primary.products.find((p) => p.id === passId)
    if (!primaryProduct) return true
    const primaryHasFullOrMonth = primary.products.some(
      (p) =>
        (p.duration_type === "full" || p.duration_type === "month") &&
        (p.purchased || p.selected),
    )
    return (
      primaryProduct.purchased ||
      primaryProduct.selected ||
      primaryHasFullOrMonth
    )
  }

  if (standardProducts.length === 0 && tierGroups.size === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground text-sm">
        No passes available for this attendee category.
      </div>
    )
  }

  return (
    <>
      {/* Tier group cards — rendered before ungrouped legacy products */}
      {tierGroups.size > 0 && (
        <div className="divide-y divide-border/50 px-4 py-3 space-y-2">
          {[...tierGroups.values()].map(({ group, products: groupProducts }) => (
            <TierGroupCard
              key={group.id}
              group={group}
              products={groupProducts}
              attendeeId={attendee.id}
              toggleProduct={toggleProduct}
              isEditing={isEditing}
            />
          ))}
        </div>
      )}

      {fullProducts.length > 0 && !isChild && (
        <>
          <div className="relative px-5 py-2 bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100 overflow-hidden">
            <div
              className="absolute inset-0 opacity-100"
              style={stripedPatternStyle}
            />
            <div className="relative flex items-center gap-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Full Passes
              </h4>
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            </div>
          </div>
          <div className="divide-y divide-border">
            {fullProducts.map((product) => {
              const disabledForSpouse = shouldDisableForPrimaryRestriction({
                checkoutMode: CHECKOUT_MODE.PASS_SYSTEM,
                attendeeCategory: attendee.category as AttendeeCategory,
                primaryHasPass: primaryHasPass(product.id),
              })
              return (
                <PassOption
                  key={product.id}
                  product={product}
                  onClick={() => toggleProduct(attendee.id, product)}
                  disabled={product.disabled || disabledForSpouse}
                  disabledReason={
                    disabledForSpouse
                      ? "Requires primary pass holder"
                      : undefined
                  }
                  isEditing={isEditing}
                />
              )
            })}
          </div>
        </>
      )}

      {monthProducts.length > 0 && !isChild && (
        <>
          <div className="relative px-5 py-2 bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100 overflow-hidden">
            <div
              className="absolute inset-0 opacity-100"
              style={stripedPatternStyle}
            />
            <div className="relative flex items-center gap-2">
              <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Month Pass
              </h4>
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            </div>
          </div>
          <div className="divide-y divide-border">
            {monthProducts.map((product) => {
              const disabledForSpouse = shouldDisableForPrimaryRestriction({
                checkoutMode: CHECKOUT_MODE.PASS_SYSTEM,
                attendeeCategory: attendee.category as AttendeeCategory,
                primaryHasPass: primaryHasPass(product.id),
              })
              return (
                <PassOption
                  key={product.id}
                  product={product}
                  onClick={() => toggleProduct(attendee.id, product)}
                  disabled={product.disabled || disabledForSpouse}
                  disabledReason={
                    disabledForSpouse
                      ? "Requires primary pass holder"
                      : undefined
                  }
                  isEditing={isEditing}
                />
              )
            })}
          </div>
        </>
      )}

      {weekProducts.length > 0 && (
        <>
          <div className="relative px-5 py-2 bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100 overflow-hidden">
            <div
              className="absolute inset-0 opacity-100"
              style={stripedPatternStyle}
            />
            <h4 className="relative text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Weekly Passes
            </h4>
          </div>
          <div className="divide-y divide-border">
            {weekProducts.map((product) => {
              const disabledForSpouse = shouldDisableForPrimaryRestriction({
                checkoutMode: CHECKOUT_MODE.PASS_SYSTEM,
                attendeeCategory: attendee.category as AttendeeCategory,
                primaryHasPass: primaryHasPass(product.id),
              })
              return (
                <PassOption
                  key={product.id}
                  product={product}
                  onClick={() => toggleProduct(attendee.id, product)}
                  disabled={
                    product.disabled ||
                    hasFullOrMonthSelected ||
                    disabledForSpouse
                  }
                  disabledReason={
                    disabledForSpouse
                      ? "Requires primary pass holder"
                      : undefined
                  }
                  isEditing={isEditing}
                />
              )
            })}
          </div>
        </>
      )}

      {dayProducts.length > 0 && (
        <>
          <div className="relative px-5 py-2 bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100 overflow-hidden">
            <div
              className="absolute inset-0 opacity-100"
              style={stripedPatternStyle}
            />
            <h4 className="relative text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              Day Passes
            </h4>
          </div>
          <div className="divide-y divide-border">
            {dayProducts.map((product) => {
              const disabledForSpouse = shouldDisableForPrimaryRestriction({
                checkoutMode: CHECKOUT_MODE.PASS_SYSTEM,
                attendeeCategory: attendee.category as AttendeeCategory,
                primaryHasPass: primaryHasPass(product.id),
              })
              return (
                <DayPassOption
                  key={product.id}
                  product={product}
                  onQuantityChange={(quantity) =>
                    toggleProduct(attendee.id, { ...product, quantity })
                  }
                  disabled={
                    product.disabled ||
                    hasFullOrMonthSelected ||
                    disabledForSpouse
                  }
                  disabledReason={
                    disabledForSpouse
                      ? "Requires primary pass holder"
                      : undefined
                  }
                  isEditing={isEditing}
                />
              )
            })}
          </div>
        </>
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// PassOption — individual pass row (unchanged from original)
// ---------------------------------------------------------------------------

interface PassOptionProps {
  product: ProductsPass
  onClick: () => void
  disabled?: boolean
  disabledReason?: string
  isEditing?: boolean
}

function PassOption({
  product,
  onClick,
  disabled,
  disabledReason,
  isEditing,
}: PassOptionProps) {
  const { purchased, selected } = product
  const isEditedForCredit = purchased && product.edit
  const comparePrice = product.compare_price ?? product.original_price
  const hasDiscount = comparePrice && comparePrice > product.price

  const isClickable = !disabled && (!purchased || isEditing)
  const isSelected = selected && !purchased

  if (purchased && !isEditing) {
    return (
      <div
        className="w-full px-5 py-3 flex items-center justify-between gap-4 cursor-not-allowed"
        style={{
          backgroundColor: "#f9f9f9",
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(0,0,0,0.03) 3px, rgba(0,0,0,0.03) 4px)",
        }}
      >
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <Ticket className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium text-muted-foreground">{product.name}</span>
            <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-semibold uppercase rounded tracking-wide border border-slate-200">
              Owned
            </span>
          </div>
          {product.start_date && product.end_date && (
            <p className="text-sm text-muted-foreground ml-6">
              {formatDate(product.start_date, {
                day: "numeric",
                month: "short",
              })}{" "}
              -{" "}
              {formatDate(product.end_date, { day: "numeric", month: "short" })}
            </p>
          )}
        </div>
      </div>
    )
  }

  if (purchased && isEditing) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "w-full px-5 py-3 flex items-center justify-between gap-4 transition-all",
          isEditedForCredit
            ? "bg-orange-50 border-l-4 border-l-orange-400"
            : "bg-muted hover:bg-muted/80",
        )}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className={cn(
              "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all border-dashed",
              isEditedForCredit
                ? "bg-orange-100 border-orange-400"
                : "border-muted-foreground",
            )}
          >
            {isEditedForCredit && <Check className="w-3 h-3 text-orange-600" />}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2">
              <Ticket
                className={cn(
                  "w-4 h-4",
                  isEditedForCredit ? "text-orange-400" : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "font-medium",
                  isEditedForCredit
                    ? "text-orange-700 line-through"
                    : "text-foreground",
                )}
              >
                {product.name}
              </span>
              <span
                className={cn(
                  "px-2 py-0.5 text-[10px] font-semibold uppercase rounded tracking-wide border",
                  isEditedForCredit
                    ? "bg-orange-100 text-orange-700 border-orange-300"
                    : "bg-slate-100 text-slate-500 border-slate-200",
                )}
              >
                {isEditedForCredit ? "Credit" : "Owned"}
              </span>
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p
            className={cn(
              "font-semibold",
              isEditedForCredit ? "text-orange-600" : "text-muted-foreground",
            )}
          >
            {isEditedForCredit
              ? `+$${product.price.toLocaleString()}`
              : `$${product.price.toLocaleString()}`}
          </p>
          {isEditedForCredit && (
            <p className="text-[10px] text-orange-500 font-medium">credit</p>
          )}
        </div>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={isClickable ? onClick : undefined}
      disabled={!isClickable}
      className={cn(
        "w-full px-5 py-3 flex items-center justify-between gap-4 transition-all",
        disabled
          ? "opacity-40 cursor-not-allowed bg-muted"
          : isSelected
            ? "bg-primary/10"
            : "hover:bg-muted",
      )}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div
          className={cn(
            "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all",
            isSelected
              ? "bg-primary border-primary"
              : disabled
                ? "border-border"
                : "border-border",
          )}
        >
          {isSelected && <Check className="w-3 h-3 text-primary-foreground" />}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <Ticket className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium text-foreground">{product.name}</span>
          </div>
          {product.start_date && product.end_date && (
            <p className="text-sm text-muted-foreground">
              {formatDate(product.start_date, {
                day: "numeric",
                month: "short",
              })}{" "}
              -{" "}
              {formatDate(product.end_date, { day: "numeric", month: "short" })}
            </p>
          )}
          {disabledReason && (
            <p className="text-xs text-amber-600 mt-1">{disabledReason}</p>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        {hasDiscount && (
          <p className="text-xs text-muted-foreground line-through">
            ${comparePrice?.toLocaleString()}
          </p>
        )}
        <p
          className={cn(
            "text-foreground",
            isSelected ? "font-bold" : "font-semibold",
          )}
        >
          ${product.price.toLocaleString()}
        </p>
      </div>
    </button>
  )
}

// ---------------------------------------------------------------------------
// DayPassOption — day pass with quantity stepper (unchanged from original)
// ---------------------------------------------------------------------------

interface DayPassOptionProps {
  product: ProductsPass
  onQuantityChange: (quantity: number) => void
  disabled?: boolean
  disabledReason?: string
  isEditing?: boolean
}

function QuantityPassOption({
  product,
  onQuantityChange,
  disabled,
  disabledReason,
  isEditing,
}: DayPassOptionProps) {
  const { purchased } = product
  const isEditedForCredit = purchased && product.edit
  const quantity = product.quantity ?? 0
  const originalQuantity = product.original_quantity ?? 0
  const comparePrice = product.compare_price ?? product.price
  const hasDiscount = comparePrice != null && comparePrice > product.price
  const maxQuantity = resolveMaxQuantity(product, {
    dayPassFallbackToDateRange: product.duration_type === "day",
  })
  const isMaxReached = quantity >= maxQuantity
  const isMinReached = purchased && quantity <= originalQuantity && !isEditing
  const hasQuantity = quantity > 0

  const handleIncrement = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isMaxReached && !disabled) onQuantityChange(quantity + 1)
  }

  const handleDecrement = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isMinReached && quantity > 0 && !disabled) {
      onQuantityChange(quantity - 1)
    }
  }

  if (purchased && isEditing) {
    const creditAmount = product.price * (product.quantity ?? 1)
    const handleEditClick = () => {
      onQuantityChange(isEditedForCredit ? originalQuantity : 0)
    }

    return (
      <button
        type="button"
        onClick={handleEditClick}
        className={cn(
          "w-full px-5 py-3 flex items-center justify-between gap-4 transition-all",
          isEditedForCredit
            ? "bg-orange-50 border-l-4 border-l-orange-400"
            : "bg-muted hover:bg-muted/80",
        )}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className={cn(
              "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all border-dashed",
              isEditedForCredit
                ? "bg-orange-100 border-orange-400"
                : "border-muted-foreground",
            )}
          >
            {isEditedForCredit && <Check className="w-3 h-3 text-orange-600" />}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2">
              <Ticket
                className={cn(
                  "w-4 h-4",
                  isEditedForCredit ? "text-orange-400" : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "font-medium",
                  isEditedForCredit
                    ? "text-orange-700 line-through"
                    : "text-foreground",
                )}
              >
                {product.name}
              </span>
              <span
                className={cn(
                  "px-2 py-0.5 text-[10px] font-semibold uppercase rounded tracking-wide border",
                  isEditedForCredit
                    ? "bg-orange-100 text-orange-700 border-orange-300"
                    : "bg-slate-100 text-slate-500 border-slate-200",
                )}
              >
                {isEditedForCredit ? "Credit" : "Owned"}
              </span>
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p
            className={cn(
              "font-semibold",
              isEditedForCredit ? "text-orange-600" : "text-muted-foreground",
            )}
          >
            {isEditedForCredit
              ? `+$${creditAmount.toLocaleString()}`
              : `$${creditAmount.toLocaleString()}`}
          </p>
        </div>
      </button>
    )
  }

  return (
    <div
      className={cn(
        "px-5 py-3 flex items-center justify-between gap-4",
        disabled ? "opacity-40" : hasQuantity ? "bg-primary/10" : "",
      )}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={handleDecrement}
            disabled={disabled || quantity === 0 || isMinReached}
            aria-label={`Decrease ${product.name} quantity`}
            className={cn(
              "w-5 h-5 rounded flex items-center justify-center transition-all",
              disabled || quantity === 0 || isMinReached
                ? "text-muted-foreground cursor-not-allowed"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span
            className={cn(
              "w-5 text-center font-semibold text-sm",
              hasQuantity ? "text-primary" : "text-muted-foreground",
            )}
          >
            {quantity}
          </span>
          <button
            type="button"
            onClick={handleIncrement}
            disabled={disabled || isMaxReached}
            aria-label={`Increase ${product.name} quantity`}
            className={cn(
              "w-5 h-5 rounded flex items-center justify-center transition-all",
              disabled || isMaxReached
                ? "text-muted-foreground cursor-not-allowed"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <Ticket className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium text-foreground">{product.name}</span>
          </div>
          <p className="text-sm text-muted-foreground">quantity-based checkout</p>
          {disabledReason && (
            <p className="text-xs text-amber-600 mt-1">{disabledReason}</p>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        {hasDiscount && (
          <p className="text-xs text-muted-foreground line-through">
            ${comparePrice?.toLocaleString()}
          </p>
        )}
        <p
          className={cn(
            "text-foreground",
            hasQuantity ? "font-bold" : "font-semibold",
          )}
        >
          ${product.price.toLocaleString()}
        </p>
      </div>
    </div>
  )
}

function DayPassOption({
  product,
  onQuantityChange,
  disabled,
  disabledReason,
  isEditing,
}: DayPassOptionProps) {
  const { purchased } = product
  const isEditedForCredit = purchased && product.edit
  const quantity = product.quantity ?? 0
  const originalQuantity = product.original_quantity ?? 0
  const comparePrice = product.compare_price ?? product.price
  const hasDiscount = comparePrice != null && comparePrice > product.price

  const calculateMaxQuantity = () => {
    if (!product.start_date || !product.end_date) return 30
    const start = new Date(product.start_date)
    const end = new Date(product.end_date)
    const diffTime = Math.abs(end.getTime() - start.getTime())
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1
  }

  const maxQuantity = calculateMaxQuantity()
  const isMaxReached = quantity >= maxQuantity
  const isMinReached = purchased && quantity <= originalQuantity && !isEditing
  const hasQuantity = quantity > 0

  const handleIncrement = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isMaxReached && !disabled) onQuantityChange(quantity + 1)
  }

  const handleDecrement = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isMinReached && quantity > 0 && !disabled)
      onQuantityChange(quantity - 1)
  }

  if (purchased && isEditing) {
    const creditAmount = product.price * (product.quantity ?? 1)
    const handleEditClick = () => {
      onQuantityChange(isEditedForCredit ? originalQuantity : 0)
    }

    return (
      <button
        type="button"
        onClick={handleEditClick}
        className={cn(
          "w-full px-5 py-3 flex items-center justify-between gap-4 transition-all",
          isEditedForCredit
            ? "bg-orange-50 border-l-4 border-l-orange-400"
            : "bg-muted hover:bg-muted/80",
        )}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className={cn(
              "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all border-dashed",
              isEditedForCredit
                ? "bg-orange-100 border-orange-400"
                : "border-muted-foreground",
            )}
          >
            {isEditedForCredit && <Check className="w-3 h-3 text-orange-600" />}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2">
              <Ticket
                className={cn(
                  "w-4 h-4",
                  isEditedForCredit ? "text-orange-400" : "text-muted-foreground",
                )}
              />
              <span
                className={cn(
                  "font-medium",
                  isEditedForCredit
                    ? "text-orange-700 line-through"
                    : "text-foreground",
                )}
              >
                {product.name} ({originalQuantity}{" "}
                {originalQuantity === 1 ? "day" : "days"})
              </span>
              <span
                className={cn(
                  "px-2 py-0.5 text-[10px] font-semibold uppercase rounded tracking-wide border",
                  isEditedForCredit
                    ? "bg-orange-100 text-orange-700 border-orange-300"
                    : "bg-slate-100 text-slate-500 border-slate-200",
                )}
              >
                {isEditedForCredit ? "Credit" : "Owned"}
              </span>
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p
            className={cn(
              "font-semibold",
              isEditedForCredit ? "text-orange-600" : "text-muted-foreground",
            )}
          >
            {isEditedForCredit
              ? `+$${creditAmount.toLocaleString()}`
              : `$${creditAmount.toLocaleString()}`}
          </p>
          {isEditedForCredit && (
            <p className="text-[10px] text-orange-500 font-medium">credit</p>
          )}
        </div>
      </button>
    )
  }

  return (
    <div
      className={cn(
        "px-5 py-3 flex items-center justify-between gap-4",
        disabled ? "opacity-40" : hasQuantity ? "bg-primary/10" : "",
      )}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            type="button"
            onClick={handleDecrement}
            disabled={disabled || quantity === 0 || isMinReached}
            aria-label="Decrease day pass quantity"
            className={cn(
              "w-5 h-5 rounded flex items-center justify-center transition-all",
              disabled || quantity === 0 || isMinReached
                ? "text-muted-foreground cursor-not-allowed"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span
            className={cn(
              "w-5 text-center font-semibold text-sm",
              hasQuantity ? "text-primary" : "text-muted-foreground",
            )}
          >
            {quantity}
          </span>
          <button
            type="button"
            onClick={handleIncrement}
            disabled={disabled || isMaxReached}
            aria-label="Increase day pass quantity"
            className={cn(
              "w-5 h-5 rounded flex items-center justify-center transition-all",
              disabled || isMaxReached
                ? "text-muted-foreground cursor-not-allowed"
                : "text-muted-foreground hover:text-foreground hover:bg-muted",
            )}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <Ticket className="w-4 h-4 text-muted-foreground" />
            <span className="font-medium text-foreground">{product.name}</span>
          </div>
          <p className="text-sm text-muted-foreground">per day</p>
          {disabledReason && (
            <p className="text-xs text-amber-600 mt-1">{disabledReason}</p>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        {hasDiscount && (
          <p className="text-xs text-muted-foreground line-through">
            ${comparePrice?.toLocaleString()}
          </p>
        )}
        <p
          className={cn(
            "text-foreground",
            hasQuantity ? "font-bold" : "font-semibold",
          )}
        >
          ${product.price.toLocaleString()}
        </p>
      </div>
    </div>
  )
}
