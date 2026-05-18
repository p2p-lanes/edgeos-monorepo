import { ChevronRight, Tag } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { useCalculateTotal } from "@/hooks/useCalculateTotal"
import { cn } from "@/lib/utils"
import { useCityProvider } from "@/providers/cityProvider"
import type { AppliedDiscount } from "@/strategies/TotalStrategy"
import type { AttendeePassState } from "@/types/Attendee"
import ProductCart from "./Products/ProductCart"

const TotalPurchase = ({
  attendees,
  isModal,
  isOpen,
  setIsOpen,
}: {
  attendees: AttendeePassState[]
  isModal?: boolean
  isOpen: boolean
  setIsOpen: (prev: boolean) => void
}) => {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const creditsEnabled = getCity()?.credits_enabled ?? false
  const {
    originalTotal,
    total,
    discountAmount,
    appliedDiscount,
    groupName,
  } = useCalculateTotal()

  // Detectar si hay productos month seleccionados
  const hasMonthSelected = attendees.some((attendee) =>
    attendee.products.some((p) => p.selected && p.duration_type === "month"),
  )

  const productsCart = attendees
    .flatMap((attendee) => {
      const selectedProducts = attendee.products.filter((p) => p.selected)

      // Si hay un month seleccionado, solo mostrar los productos month
      if (hasMonthSelected) {
        return selectedProducts.filter((p) => p.duration_type === "month")
      }

      // L├│gica original si no hay month seleccionado
      return selectedProducts
    })
    .sort((a, b) => {
      if (a.category === "patreon") return -1
      if (b.category === "patreon") return 1
      return 0
    })

  const patreonSelected = attendees.some((attendee) =>
    attendee.products.some((p) => p.selected && p.category === "patreon"),
  )

  return (
    <Collapsible
      open={isOpen}
      onOpenChange={setIsOpen}
      className="space-y-4 pt-0"
      data-cart
    >
      <CollapsibleTrigger
        className={cn(
          "w-full bg-muted rounded-md",
          isModal && "bg-transparent",
        )}
      >
        <div className="flex justify-between items-center p-3">
          <div className="flex items-center gap-2">
            <ChevronRight
              className={cn(
                "h-4 w-4 transition-transform duration-200",
                isOpen && "transform rotate-90",
              )}
            />
            <span className="font-medium">{t("passes.total")}</span>
          </div>

          <div className="flex items-center gap-2">
            {originalTotal > 0 && originalTotal !== total && (
              <span className="text-xs text-muted-foreground line-through">
                ${originalTotal.toFixed(2)}
              </span>
            )}
            <span className="font-medium" data-total={total.toFixed(2)}>
              ${total > 0 ? total.toFixed(2) : 0}
            </span>
          </div>
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="transition-all duration-100 ease-in-out data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown">
        {productsCart.length > 0 ? (
          <div className="space-y-2 px-3">
            {productsCart.map((product) => (
              <ProductCart key={product.id} product={product} />
            ))}

            {/* <DiscountMonth attendees={attendees} total={total}/> */}

            {creditsEnabled && (
              <DiscountWeekPurchased
                attendees={attendees}
                hasMonthSelected={hasMonthSelected}
              />
            )}

            <AppliedDiscountDisplay
              appliedDiscount={appliedDiscount}
              discountAmount={discountAmount}
              groupName={groupName}
              patreonSelected={patreonSelected}
            />

            {/* LEGACY: application.credit was removed from API */}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground px-3">
            {t("passes.no_passes_selected")}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  )
}

const AppliedDiscountDisplay = ({
  appliedDiscount,
  discountAmount,
  groupName,
  patreonSelected,
}: {
  appliedDiscount: AppliedDiscount
  discountAmount: number
  groupName: string | null
  patreonSelected: boolean
}) => {
  const { t } = useTranslation()

  if (appliedDiscount.type === "none") return null

  if (appliedDiscount.type === "group") {
    if (!appliedDiscount.percentage) return null
    return (
      <div className="flex justify-between text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <Tag className="w-4 h-4" />
          <span className="text-sm text-muted-foreground">
            {groupName
              ? t("passes.discounts.group_named", {
                  name: groupName,
                  percent: appliedDiscount.percentage,
                })
              : t("passes.discounts.group_generic", {
                  percent: appliedDiscount.percentage,
                })}
          </span>
        </div>
        <span className="text-green-600 font-medium">
          {t("passes.discounts.applied")}
        </span>
      </div>
    )
  }

  if (discountAmount <= 0) return null

  const getLabel = () => {
    if (appliedDiscount.type === "scholarship") {
      return t("passes.discounts.scholarship", {
        percent: appliedDiscount.percentage,
      })
    }
    if (patreonSelected) {
      return t("passes.discounts.patron_free")
    }
    if (appliedDiscount.code) {
      return t("passes.discounts.code", {
        code: appliedDiscount.code,
        percent: appliedDiscount.percentage,
      })
    }
    return t("passes.discounts.generic", {
      percent: appliedDiscount.percentage,
    })
  }

  return (
    <div className="flex justify-between text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <Tag className="w-4 h-4" />
        <span className="text-sm text-muted-foreground">{getLabel()}</span>
      </div>
      <span data-discount-amount={discountAmount.toFixed(0)}>
        {" "}
        - ${discountAmount.toFixed(0)}
      </span>
    </div>
  )
}

const _DiscountMonth = ({
  attendees,
  total,
}: {
  attendees: AttendeePassState[]
  total: number
}) => {
  const calculateDiscountMonth = () => {
    const totalPrice = attendees.reduce((total, attendee) => {
      return (
        total +
        attendee.products
          .filter((p) => p.selected && p.duration_type === "week")
          .reduce((sum, product) => sum + (product.price ?? 0), 0)
      )
    }, 0)

    return totalPrice - total
  }
  // const hasPatreon = attendees.some(attendee => attendee.products.some(p => p.category === 'patreon' && (p.selected || p.purchased)))
  const hasMonthSelected = attendees.some((attendee) =>
    attendee.products.some((p) => p.selected && p.duration_type === "month"),
  )

  if (!hasMonthSelected) return null

  const discountMonth = calculateDiscountMonth()

  if (discountMonth <= 0) return null

  return (
    <div className="flex justify-between text-sm text-muted-foreground">
      <span className="flex items-center gap-2">
        <Tag className="w-4 h-4" />
        Discount on Full Month
      </span>
      <span data-month-discount={discountMonth}>
        {" "}
        - ${discountMonth.toFixed(0)}
      </span>
    </div>
  )
}

const DiscountWeekPurchased = ({
  attendees,
  hasMonthSelected,
}: {
  attendees: AttendeePassState[]
  hasMonthSelected: boolean
}) => {
  const { t } = useTranslation()
  if (!hasMonthSelected) return null

  const calculateWeekPurchasedDiscount = () => {
    return attendees.reduce((totalDiscount, attendee) => {
      // Verificar si este attendee tiene un month seleccionado
      const hasMonthSelectedForAttendee = attendee.products.some(
        (p) => p.selected && p.duration_type === "month",
      )

      if (!hasMonthSelectedForAttendee) return totalDiscount

      // Buscar productos week comprados para este attendee
      const weekPurchasedProducts = attendee.products.filter(
        (p) => p.purchased && p.duration_type === "week",
      )

      // Sumar el original_price de los productos week comprados
      const weekDiscount = weekPurchasedProducts.reduce((sum, product) => {
        const price = product.price || 0
        return sum + price
      }, 0)

      return totalDiscount + weekDiscount
    }, 0)
  }

  const weekDiscount = calculateWeekPurchasedDiscount()

  if (weekDiscount <= 0) return null

  return (
    <div className="flex justify-between text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <Tag className="w-4 h-4" />
        <span className="text-sm text-muted-foreground">
          {t("passes.discounts.week_credit")}
        </span>
      </div>
      <span data-week-discount={weekDiscount.toFixed(0)}>
        {" "}
        - ${weekDiscount.toFixed(0)}
      </span>
    </div>
  )
}

export default TotalPurchase
