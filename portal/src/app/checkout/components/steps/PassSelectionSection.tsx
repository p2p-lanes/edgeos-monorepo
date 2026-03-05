"use client"

import { motion } from "framer-motion"
import { Check, Minus, Plus, Sparkles, Ticket, User } from "lucide-react"
import { badgeName } from "@/app/portal/[popupSlug]/passes/constants/multiuse"
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

const getCategoryLabel = (category: AttendeeCategory): string => {
  return badgeName[category] || category
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
  const city = getCity()

  const hasSpouse = attendeePasses.some((a) => a.category === "spouse")

  const handleAddSpouse = () => {
    onAddAttendee?.("spouse")
  }

  const handleAddChild = () => {
    onAddAttendee?.("kid")
  }

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
              onClick={handleAddSpouse}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Add spouse
            </button>
          )}
          {!isEditing && city?.allows_children && (
            <button
              type="button"
              onClick={handleAddChild}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Add child
            </button>
          )}
        </div>
      </div>

      {/* Family Member Pass Selection */}
      {attendeePasses.map((attendee) => (
        <AttendeePassCard
          key={attendee.id}
          attendee={attendee}
          toggleProduct={toggleProduct}
          isEditing={isEditing}
          allAttendees={attendeePasses}
        />
      ))}
    </motion.div>
  )
}

interface AttendeePassCardProps {
  attendee: AttendeePassState
  toggleProduct: (attendeeId: string, product: ProductsPass) => void
  isEditing: boolean
  allAttendees: AttendeePassState[]
}

function AttendeePassCard({
  attendee,
  toggleProduct,
  isEditing,
  allAttendees,
}: AttendeePassCardProps) {
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

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Member Header */}
      <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/50">
        <div className="flex items-center gap-3">
          <div className="bg-gray-100 p-2 rounded-full">
            <User className="w-4 h-4 text-gray-600" />
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">{attendee.name}</h3>
            <p className="text-sm text-gray-500">
              {getCategoryLabel(attendee.category as AttendeeCategory)}
            </p>
          </div>
        </div>
      </div>

      {/* Full Pass Section */}
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
              const isDisabled = product.disabled || disabledForSpouse

              return (
                <PassOption
                  key={product.id}
                  product={product}
                  onClick={() => toggleProduct(attendee.id, product)}
                  disabled={isDisabled}
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

      {/* Month Pass Section */}
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
              const isDisabled = product.disabled || disabledForSpouse

              return (
                <PassOption
                  key={product.id}
                  product={product}
                  onClick={() => toggleProduct(attendee.id, product)}
                  disabled={isDisabled}
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

      {/* Weekly Passes Section */}
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
              const isDisabled =
                product.disabled || hasFullOrMonthSelected || disabledForSpouse

              return (
                <PassOption
                  key={product.id}
                  product={product}
                  onClick={() => toggleProduct(attendee.id, product)}
                  disabled={isDisabled}
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

      {/* Day Passes Section */}
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
              const isDisabled =
                product.disabled || hasFullOrMonthSelected || disabledForSpouse

              return (
                <DayPassOption
                  key={product.id}
                  product={product}
                  onQuantityChange={(quantity) => {
                    const updatedProduct = { ...product, quantity }
                    toggleProduct(attendee.id, updatedProduct)
                  }}
                  disabled={isDisabled}
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

      {standardProducts.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          No passes available for this attendee category.
        </div>
      )}
    </div>
  )
}

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
              {formatDate(product.end_date, {
                day: "numeric",
                month: "short",
              })}
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
              {formatDate(product.end_date, {
                day: "numeric",
                month: "short",
              })}
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
    if (!isMaxReached && !disabled) {
      onQuantityChange(quantity + 1)
    }
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
