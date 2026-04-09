"use client"

import { motion } from "framer-motion"
import {
  Baby,
  Check,
  ChevronDown,
  Heart,
  Minus,
  Plus,
  Sparkles,
  Ticket,
  User,
  Users,
} from "lucide-react"
import { useMemo, useState } from "react"
import { badgeName } from "@/app/portal/[popupSlug]/passes/constants/multiuse"
import { useDesignVariant } from "@/context/designVariant"
import { formatDate } from "@/helpers/dates"
import { cn } from "@/lib/utils"
import { useCheckout } from "@/providers/checkoutProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import type { AttendeeCategory, AttendeePassState } from "@/types/Attendee"
import type { ProductsPass } from "@/types/Products"

interface PassSelectionSectionProps {
  onAddAttendee?: (category: AttendeeCategory) => void
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

export default function PassSelectionSection({
  onAddAttendee,
}: PassSelectionSectionProps) {
  const { attendeePasses, toggleProduct, isEditing } = usePassesProvider()
  const { editCredit } = useCheckout()
  const { getCity } = useCityProvider()
  const { passesVariant } = useDesignVariant()
  const city = getCity()

  const hasSpouse = attendeePasses.some((a) => a.category === "spouse")

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
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-semibold text-blue-900">Edit Mode</p>
              <p className="text-sm text-blue-700">
                Click on a purchased pass to get credit, then select a new pass.
              </p>
            </div>
            {editCredit > 0 && (
              <div className="bg-blue-100 px-3 py-1.5 rounded-lg">
                <p className="text-sm font-semibold text-blue-800">
                  Credit: ${editCredit.toLocaleString()}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Toolbar: Add Family Members */}
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <div className="flex items-center gap-2">
          {!isEditing && !hasSpouse && city?.allows_spouse && (
            <button
              type="button"
              onClick={() => onAddAttendee?.("spouse")}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Add spouse
            </button>
          )}
          {!isEditing && city?.allows_children && (
            <button
              type="button"
              onClick={() => onAddAttendee?.("kid")}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Add child
            </button>
          )}
        </div>
      </div>

      {/* Variant Renderers */}
      {passesVariant === "stacked" && (
        <StackedVariant
          groupedByCategory={groupedByCategory}
          allAttendees={attendeePasses}
          toggleProduct={toggleProduct}
          isEditing={isEditing}
        />
      )}
      {passesVariant === "tabs" && (
        <TabsVariant
          groupedByCategory={groupedByCategory}
          allAttendees={attendeePasses}
          toggleProduct={toggleProduct}
          isEditing={isEditing}
        />
      )}
      {passesVariant === "compact" && (
        <CompactVariant
          groupedByCategory={groupedByCategory}
          allAttendees={attendeePasses}
          toggleProduct={toggleProduct}
          isEditing={isEditing}
        />
      )}
      {passesVariant === "accordion" && (
        <AccordionVariant
          groupedByCategory={groupedByCategory}
          allAttendees={attendeePasses}
          toggleProduct={toggleProduct}
          isEditing={isEditing}
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
}

// ---------------------------------------------------------------------------
// Variant A: Stacked — one card per category, visually distinct headers
// ---------------------------------------------------------------------------

function StackedVariant({
  groupedByCategory,
  allAttendees,
  toggleProduct,
  isEditing,
}: VariantProps) {
  return (
    <div className="space-y-3">
      {groupedByCategory.map(([category, attendees]) => {
        const colors = getCategoryColors(category)
        const Icon = getCategoryIcon(category)
        const groupLabel = getCategoryGroupLabel(category)

        return (
          <div
            key={category}
            className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden"
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
              <div key={attendee.id}>
                {attendees.length > 1 && (
                  <div className="px-5 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                    <User className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-xs font-medium text-gray-600">
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
                  <div className="h-px bg-gray-100 mx-5" />
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
// Variant B: Tabs — category tab switcher
// ---------------------------------------------------------------------------

function TabsVariant({
  groupedByCategory,
  allAttendees,
  toggleProduct,
  isEditing,
}: VariantProps) {
  const [activeCategory, setActiveCategory] = useState(
    () => groupedByCategory[0]?.[0] ?? "main",
  )

  const activeGroup =
    groupedByCategory.find(([cat]) => cat === activeCategory) ??
    groupedByCategory[0]

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Tab Bar */}
      <div className="flex border-b border-gray-100 bg-gray-50/50">
        {groupedByCategory.map(([category, attendees]) => {
          const colors = getCategoryColors(category)
          const Icon = getCategoryIcon(category)
          const isActive = activeCategory === category
          return (
            <button
              key={category}
              type="button"
              onClick={() => setActiveCategory(category)}
              className={cn(
                "flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-all border-b-2",
                isActive
                  ? cn(colors.tab, "bg-white")
                  : "text-gray-500 border-transparent hover:text-gray-700 hover:bg-gray-50",
              )}
            >
              <Icon className="w-4 h-4" />
              <span>{getCategoryGroupLabel(category)}</span>
              {attendees.length > 1 && (
                <span
                  className={cn(
                    "text-xs px-1.5 py-0.5 rounded-full font-semibold",
                    isActive ? colors.badge : "bg-gray-100 text-gray-500",
                  )}
                >
                  {attendees.length}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab Content */}
      {activeGroup && (
        <motion.div
          key={activeCategory}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          {activeGroup[1].map((attendee, idx) => (
            <div key={attendee.id}>
              {activeGroup[1].length > 1 && (
                <div className="px-5 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                  <User className="w-3.5 h-3.5 text-gray-400" />
                  <span className="text-xs font-medium text-gray-600">
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
              {idx < activeGroup[1].length - 1 && (
                <div className="h-px bg-gray-100 mx-5" />
              )}
            </div>
          ))}
        </motion.div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Variant C: Compact — pill/chip style ticket buttons per category
// ---------------------------------------------------------------------------

function CompactVariant({
  groupedByCategory,
  allAttendees,
  toggleProduct,
  isEditing,
}: VariantProps) {
  return (
    <div className="space-y-4">
      {groupedByCategory.map(([category, attendees]) => {
        const colors = getCategoryColors(category)
        const Icon = getCategoryIcon(category)

        return (
          <div key={category} className="space-y-2">
            {/* Category label */}
            <div className="flex items-center gap-2">
              <div
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold",
                  colors.header,
                )}
              >
                <Icon className="w-3.5 h-3.5" />
                {getCategoryGroupLabel(category)}
              </div>
              {attendees.length > 1 && (
                <div className="flex items-center gap-1 text-xs text-gray-400">
                  <Users className="w-3 h-3" />
                  {attendees.length} members
                </div>
              )}
            </div>

            {attendees.map((attendee) => {
              const primaryHasPass = (passId: string): boolean => {
                const primary = allAttendees.find((a) => a.category === "main")
                if (!primary) return true
                const primaryProduct = primary.products.find(
                  (p) => p.id === passId,
                )
                if (!primaryProduct) return true
                const primaryHasFullOrMonth = primary.products.some(
                  (p) =>
                    (p.duration_type === "full" ||
                      p.duration_type === "month") &&
                    (p.purchased || p.selected),
                )
                return (
                  primaryProduct.purchased ||
                  primaryProduct.selected ||
                  primaryHasFullOrMonth
                )
              }

              const standardProducts = attendee.products
                .filter((p) => p.category !== "patreon")
                .sort(sortProductsByPriority)

              const isChild =
                attendee.category === "kid" ||
                attendee.category === "teen" ||
                attendee.category === "baby"

              const hasFullOrMonthSelected = attendee.products.some(
                (p) =>
                  (p.duration_type === "full" || p.duration_type === "month") &&
                  (p.purchased || p.selected),
              )

              return (
                <div
                  key={attendee.id}
                  className={cn(
                    "bg-white rounded-xl border border-gray-100 p-3 shadow-sm",
                    `border-l-2 ${colors.accent}`,
                  )}
                >
                  {attendees.length > 1 && (
                    <p className="text-xs font-medium text-gray-500 mb-2 flex items-center gap-1">
                      <User className="w-3 h-3" />
                      {attendee.name}
                    </p>
                  )}
                  {standardProducts.length === 0 ? (
                    <p className="text-xs text-gray-400 py-1">
                      No passes available.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {standardProducts.map((product) => {
                        if (product.duration_type === "day") {
                          const _qty = product.quantity ?? 0
                          const isDisabled =
                            product.disabled ||
                            hasFullOrMonthSelected ||
                            (attendee.category === "spouse" &&
                              !primaryHasPass(product.id))
                          return (
                            <CompactDayPill
                              key={product.id}
                              product={product}
                              disabled={isDisabled}
                              onQuantityChange={(quantity) =>
                                toggleProduct(attendee.id, {
                                  ...product,
                                  quantity,
                                })
                              }
                              isEditing={isEditing}
                            />
                          )
                        }

                        const isSpouseDisabled =
                          attendee.category === "spouse" &&
                          !primaryHasPass(product.id)
                        const isDisabled =
                          product.disabled ||
                          isSpouseDisabled ||
                          (product.duration_type === "week" &&
                            hasFullOrMonthSelected) ||
                          (isChild &&
                            (product.duration_type === "full" ||
                              product.duration_type === "month"))

                        const isSelected =
                          product.selected && !product.purchased
                        const isPurchased = product.purchased

                        return (
                          <button
                            key={product.id}
                            type="button"
                            onClick={
                              isDisabled || (isPurchased && !isEditing)
                                ? undefined
                                : () => toggleProduct(attendee.id, product)
                            }
                            disabled={isDisabled || (isPurchased && !isEditing)}
                            className={cn(
                              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                              isPurchased && !isEditing
                                ? "bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed"
                                : isSelected
                                  ? "bg-blue-600 border-blue-600 text-white shadow-sm"
                                  : isPurchased && isEditing && product.edit
                                    ? "bg-orange-50 border-orange-400 text-orange-700"
                                    : isDisabled
                                      ? "bg-gray-50 border-gray-100 text-gray-300 cursor-not-allowed opacity-50"
                                      : "bg-white border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50",
                            )}
                          >
                            {isSelected && <Check className="w-3 h-3" />}
                            {isPurchased && !isEditing && (
                              <Ticket className="w-3 h-3" />
                            )}
                            <span>{product.name}</span>
                            <span
                              className={cn(
                                "font-semibold",
                                isSelected ? "opacity-80" : "",
                              )}
                            >
                              ${product.price.toLocaleString()}
                            </span>
                            {isPurchased && !isEditing && (
                              <span className="text-[10px] uppercase tracking-wide opacity-60">
                                owned
                              </span>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

interface CompactDayPillProps {
  product: ProductsPass
  disabled: boolean
  onQuantityChange: (qty: number) => void
  isEditing: boolean
}

function CompactDayPill({
  product,
  disabled,
  onQuantityChange,
  isEditing,
}: CompactDayPillProps) {
  const qty = product.quantity ?? 0
  const hasQty = qty > 0

  const calculateMax = () => {
    if (!product.start_date || !product.end_date) return 30
    const start = new Date(product.start_date)
    const end = new Date(product.end_date)
    return (
      Math.ceil(
        Math.abs(end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24),
      ) + 1
    )
  }

  const max = calculateMax()
  const originalQty = product.original_quantity ?? 0
  const isMinReached = product.purchased && qty <= originalQty && !isEditing

  return (
    <div
      className={cn(
        "flex items-center gap-1 px-2 py-1.5 rounded-lg border text-xs font-medium transition-all",
        disabled
          ? "opacity-40 bg-gray-50 border-gray-100"
          : hasQty
            ? "bg-blue-50 border-blue-300"
            : "bg-white border-gray-200",
      )}
    >
      <button
        type="button"
        onClick={() =>
          !disabled && !isMinReached && qty > 0 && onQuantityChange(qty - 1)
        }
        disabled={disabled || qty === 0 || isMinReached}
        aria-label="Decrease"
        className={cn(
          "w-4 h-4 flex items-center justify-center rounded transition-colors",
          disabled || qty === 0 || isMinReached
            ? "text-gray-300 cursor-not-allowed"
            : "text-gray-500 hover:text-gray-800 hover:bg-gray-100",
        )}
      >
        <Minus className="w-3 h-3" />
      </button>
      <span
        className={cn(
          "w-4 text-center",
          hasQty ? "text-blue-600 font-semibold" : "text-gray-400",
        )}
      >
        {qty}
      </span>
      <button
        type="button"
        onClick={() => !disabled && qty < max && onQuantityChange(qty + 1)}
        disabled={disabled || qty >= max}
        aria-label="Increase"
        className={cn(
          "w-4 h-4 flex items-center justify-center rounded transition-colors",
          disabled || qty >= max
            ? "text-gray-300 cursor-not-allowed"
            : "text-gray-500 hover:text-gray-800 hover:bg-gray-100",
        )}
      >
        <Plus className="w-3 h-3" />
      </button>
      <Ticket
        className={cn(
          "w-3 h-3 ml-0.5",
          hasQty ? "text-blue-500" : "text-gray-300",
        )}
      />
      <span className={hasQty ? "text-blue-700" : "text-gray-600"}>
        {product.name}
      </span>
      <span
        className={cn(
          "font-semibold ml-0.5",
          hasQty ? "text-blue-600" : "text-gray-500",
        )}
      >
        ${product.price.toLocaleString()}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Variant D: Accordion — collapsible category sections
// ---------------------------------------------------------------------------

function AccordionVariant({
  groupedByCategory,
  allAttendees,
  toggleProduct,
  isEditing,
}: VariantProps) {
  const [openCategories, setOpenCategories] = useState<Set<string>>(
    () => new Set(["main"]),
  )

  const toggle = (cat: string) => {
    setOpenCategories((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  return (
    <div className="space-y-2">
      {groupedByCategory.map(([category, attendees]) => {
        const colors = getCategoryColors(category)
        const Icon = getCategoryIcon(category)
        const isOpen = openCategories.has(category)
        const selectedCount = attendees.reduce(
          (sum, a) =>
            sum + a.products.filter((p) => p.selected || p.purchased).length,
          0,
        )

        return (
          <div
            key={category}
            className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden"
          >
            {/* Accordion Header */}
            <button
              type="button"
              onClick={() => toggle(category)}
              className="w-full flex items-center gap-3 px-5 py-4 hover:bg-gray-50/80 transition-colors"
            >
              <div
                className={cn(
                  "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                  colors.header,
                )}
              >
                <Icon className="w-4 h-4" />
              </div>
              <div className="flex-1 text-left">
                <p className="font-semibold text-gray-900 text-sm">
                  {getCategoryGroupLabel(category)}
                </p>
                {attendees.length > 1 && (
                  <p className="text-xs text-gray-400">
                    {attendees.length} members
                  </p>
                )}
              </div>
              {selectedCount > 0 && (
                <span
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full font-semibold mr-1",
                    colors.badge,
                  )}
                >
                  {selectedCount} selected
                </span>
              )}
              <ChevronDown
                className={cn(
                  "w-4 h-4 text-gray-400 transition-transform duration-200",
                  isOpen && "rotate-180",
                )}
              />
            </button>

            {/* Accordion Content */}
            {isOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.2, ease: "easeOut" }}
                className="border-t border-gray-100"
              >
                {attendees.map((attendee, idx) => (
                  <div key={attendee.id}>
                    {attendees.length > 1 && (
                      <div className="px-5 py-2 bg-gray-50 border-b border-gray-100 flex items-center gap-2">
                        <User className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-xs font-medium text-gray-600">
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
                      <div className="h-px bg-gray-100 mx-5" />
                    )}
                  </div>
                ))}
              </motion.div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// AttendeePassCardBody — shared pass list body (used by Stacked, Tabs, Accordion)
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

  const standardProducts = attendee.products
    .filter((product) => product.category !== "patreon")
    .sort(sortProductsByPriority)

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

  if (standardProducts.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        No passes available for this attendee category.
      </div>
    )
  }

  return (
    <>
      {fullProducts.length > 0 && !isChild && (
        <>
          <div className="relative px-5 py-2 bg-gradient-to-r from-gray-100 via-gray-50 to-gray-100 overflow-hidden">
            <div
              className="absolute inset-0 opacity-100"
              style={stripedPatternStyle}
            />
            <div className="relative flex items-center gap-2">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Full Passes
              </h4>
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {fullProducts.map((product) => {
              const isSpouse = attendee.category === "spouse"
              const disabledForSpouse = isSpouse && !primaryHasPass(product.id)
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
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                Month Pass
              </h4>
              <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {monthProducts.map((product) => {
              const isSpouse = attendee.category === "spouse"
              const disabledForSpouse = isSpouse && !primaryHasPass(product.id)
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
            <h4 className="relative text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Weekly Passes
            </h4>
          </div>
          <div className="divide-y divide-gray-100">
            {weekProducts.map((product) => {
              const isSpouse = attendee.category === "spouse"
              const disabledForSpouse = isSpouse && !primaryHasPass(product.id)
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
            <h4 className="relative text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Day Passes
            </h4>
          </div>
          <div className="divide-y divide-gray-100">
            {dayProducts.map((product) => {
              const isSpouse = attendee.category === "spouse"
              const disabledForSpouse = isSpouse && !primaryHasPass(product.id)
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
            <Ticket className="w-4 h-4 text-gray-300" />
            <span className="font-medium text-gray-400">{product.name}</span>
            <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-[10px] font-semibold uppercase rounded tracking-wide border border-slate-200">
              Owned
            </span>
          </div>
          {product.start_date && product.end_date && (
            <p className="text-sm text-gray-400 ml-6">
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
            : "bg-gray-50 hover:bg-gray-100",
        )}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className={cn(
              "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all border-dashed",
              isEditedForCredit
                ? "bg-orange-100 border-orange-400"
                : "border-gray-400",
            )}
          >
            {isEditedForCredit && <Check className="w-3 h-3 text-orange-600" />}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2">
              <Ticket
                className={cn(
                  "w-4 h-4",
                  isEditedForCredit ? "text-orange-400" : "text-gray-400",
                )}
              />
              <span
                className={cn(
                  "font-medium",
                  isEditedForCredit
                    ? "text-orange-700 line-through"
                    : "text-gray-700",
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
              isEditedForCredit ? "text-orange-600" : "text-gray-500",
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
          ? "opacity-40 cursor-not-allowed bg-gray-50"
          : isSelected
            ? "bg-blue-50"
            : "hover:bg-gray-50",
      )}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <div
          className={cn(
            "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all",
            isSelected
              ? "bg-blue-600 border-blue-600"
              : disabled
                ? "border-gray-200"
                : "border-gray-300",
          )}
        >
          {isSelected && <Check className="w-3 h-3 text-white" />}
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <Ticket className="w-4 h-4 text-gray-400" />
            <span className="font-medium text-gray-900">{product.name}</span>
          </div>
          {product.start_date && product.end_date && (
            <p className="text-sm text-gray-500">
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
          <p className="text-xs text-gray-400 line-through">
            ${comparePrice?.toLocaleString()}
          </p>
        )}
        <p
          className={cn(
            "font-semibold",
            isSelected ? "text-blue-600" : "text-gray-900",
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
            : "bg-gray-50 hover:bg-gray-100",
        )}
      >
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div
            className={cn(
              "w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all border-dashed",
              isEditedForCredit
                ? "bg-orange-100 border-orange-400"
                : "border-gray-400",
            )}
          >
            {isEditedForCredit && <Check className="w-3 h-3 text-orange-600" />}
          </div>
          <div className="flex-1 min-w-0 text-left">
            <div className="flex items-center gap-2">
              <Ticket
                className={cn(
                  "w-4 h-4",
                  isEditedForCredit ? "text-orange-400" : "text-gray-400",
                )}
              />
              <span
                className={cn(
                  "font-medium",
                  isEditedForCredit
                    ? "text-orange-700 line-through"
                    : "text-gray-700",
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
              isEditedForCredit ? "text-orange-600" : "text-gray-500",
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
        disabled ? "opacity-40" : hasQuantity ? "bg-blue-50" : "",
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
                ? "text-gray-300 cursor-not-allowed"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-100",
            )}
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <span
            className={cn(
              "w-5 text-center font-semibold text-sm",
              hasQuantity ? "text-blue-600" : "text-gray-400",
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
                ? "text-gray-300 cursor-not-allowed"
                : "text-gray-500 hover:text-gray-700 hover:bg-gray-100",
            )}
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
        <div className="flex-1 min-w-0 text-left">
          <div className="flex items-center gap-2">
            <Ticket className="w-4 h-4 text-gray-400" />
            <span className="font-medium text-gray-900">{product.name}</span>
          </div>
          <p className="text-sm text-gray-500">per day</p>
          {disabledReason && (
            <p className="text-xs text-amber-600 mt-1">{disabledReason}</p>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        {hasDiscount && (
          <p className="text-xs text-gray-400 line-through">
            ${comparePrice?.toLocaleString()}
          </p>
        )}
        <p
          className={cn(
            "font-semibold",
            hasQuantity ? "text-blue-600" : "text-gray-900",
          )}
        >
          ${product.price.toLocaleString()}
        </p>
      </div>
    </div>
  )
}
