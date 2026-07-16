import { useQuery } from "@tanstack/react-query"
import { ChevronRight, Pencil, QrCode, User } from "lucide-react"
import Image from "next/image"
import React, { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { TICKET_CATEGORY } from "@/checkout/popupCheckoutPolicy"
import { TicketingStepsService } from "@/client"
import {
  mealPlanProductIds,
  parseMealPlanTemplateConfig,
} from "@/components/checkout-flow/variants/mealPlanShared"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import useAttendee from "@/hooks/useAttendee"
import { imageOptimization } from "@/lib/image-optimization"
import { deriveProductState } from "@/lib/product-state"
import { cn } from "@/lib/utils"
import { useCityProvider } from "@/providers/cityProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import type { AttendeePassState, TicketEntry } from "@/types/Attendee"
import type { ProductsPass } from "@/types/Products"
import { badgeName } from "../../constants/multiuse"
import useModal from "../../hooks/useModal"
import { compareByCategory, getCategoryIcon } from "../../utils/categoryDisplay"
import { AttendeeModal } from "../AttendeeModal"
import OptionsMenu from "./Buttons/OptionsMenu"
import { MealPlanEditModal } from "./MealPlanEditModal"
import Product from "./Products/ProductTicket"
import QRcode from "./QRcode"

const getDurationPriority = (p: ProductsPass): number => {
  const dt = p.duration_type
  if (dt === "month") return 0
  if (dt === "full") return 1
  if (dt === "week") return 2
  if (dt === "day") return 999
  return 4
}

const sortProductsByPriority = (a: ProductsPass, b: ProductsPass): number => {
  return getDurationPriority(a) - getDurationPriority(b)
}

const AttendeeTicket = ({
  attendee,
  toggleProduct,
  isDayCheckout,
  onSwitchToBuy,
}: {
  attendee: AttendeePassState
  toggleProduct?: (attendeeId: string, product: ProductsPass) => void
  isDayCheckout?: boolean
  onSwitchToBuy?: () => void
}) => {
  const { t } = useTranslation()
  const standardProducts = attendee.products
    .filter(
      (product) =>
        product.category !== "patreon" &&
        (toggleProduct ? product.is_active !== false : true) &&
        (isDayCheckout ? product.duration_type === "day" : true),
    )
    .sort(sortProductsByPriority)
  const { getCity } = useCityProvider()
  const city = getCity()
  const { products } = usePassesProvider()
  const { handleEdit, handleCloseModal, modal, handleDelete } = useModal()
  const { removeAttendee, editAttendee } = useAttendee()
  const hasPurchased = attendee.products.some((product) => product.purchased)
  const isMainAttendee = attendee.category === "main"

  // Meal-plan editing: resolve which purchased tickets are meal-plan weeks via
  // the popup's meal-plan-select step config (more robust than matching a
  // configurable category string). Reuses the same portal query as YourPasses,
  // so React Query dedupes it by key.
  const popupId = city?.id ? String(city.id) : null
  const { data: ticketingStepsData } = useQuery({
    queryKey: ["ticketing-steps-portal", popupId],
    queryFn: () =>
      TicketingStepsService.listPortalTicketingSteps({ popupId: popupId! }),
    enabled: !!popupId,
  })
  const mealPlanStep = (ticketingStepsData?.results ?? []).find(
    (s) => s.template === "meal-plan-select",
  )
  const mealPlanTemplateConfig = mealPlanStep?.template_config ?? null
  const mealPlanIds = useMemo(
    () => mealPlanProductIds(mealPlanTemplateConfig),
    [mealPlanTemplateConfig],
  )

  // Resolve each meal-plan product so we can (a) apply the same per-week lock
  // rule the modal uses (deriveProductState === "ended") and (b) order the weeks
  // chronologically. coverageStart comes from the meal-plan-select step config.
  const mealPlanInfoById = useMemo(() => {
    const { sections } = parseMealPlanTemplateConfig(
      mealPlanTemplateConfig,
      products,
    )
    const map = new Map<
      string,
      { product: ProductsPass; coverageStart: string }
    >()
    for (const section of sections) {
      for (const p of section.products) {
        map.set(p.id, { product: p.product, coverageStart: p.coverageStart })
      }
    }
    return map
  }, [mealPlanTemplateConfig, products])

  const isMealPlanEntryEditable = (entry: TicketEntry): boolean => {
    const product = mealPlanInfoById.get(entry.product_id)?.product
    if (!product) return false
    return deriveProductState(product) !== "ended"
  }

  const [editingEntryId, setEditingEntryId] = useState<string | null>(null)

  // Used by buy mode <Product> components to disable day/week tickets when a
  // monthly pass is selected/purchased (buy-mode logic is out of scope here).
  const hasMonthPurchased = attendee.products.some(
    (product) =>
      (product.duration_type === "month" || product.duration_type === "full") &&
      (product.purchased || product.selected),
  )

  // LEGACY: application.local_resident was removed from API
  const isLocalResident = false

  // All ticket products go into commonProducts (local categories no longer exist)
  const localProducts: ProductsPass[] = []
  const commonProducts = standardProducts.filter(
    (p) => p.category === TICKET_CATEGORY,
  )

  // Ticket entries for view mode: exclude patreon, sort by category order.
  // Within meal-plan weeks (same category) order chronologically by coverage
  // start so editing a week never reshuffles the list (the API may return the
  // just-edited row last).
  const ticketEntries = [...(attendee.ticket_entries ?? [])]
    .filter((e) => e.product_category !== "patreon")
    .sort((a, b) => {
      const byCategory = compareByCategory(a, b)
      if (byCategory !== 0) return byCategory
      const aStart = mealPlanInfoById.get(a.product_id)?.coverageStart
      const bStart = mealPlanInfoById.get(b.product_id)?.coverageStart
      if (aStart && bStart) return aStart.localeCompare(bStart)
      return 0
    })

  // Purchased meal-plan tickets (any week of the plan). The edit button on each
  // such row opens a single modal that edits all of this attendee's weeks.
  const mealPlanEntries = ticketEntries.filter((e) =>
    mealPlanIds.has(e.product_id),
  )

  // Inline QR modal state — drives the shared <QRcode> modal at bottom of file.
  // Tracks lastScanAt alongside the code so the modal can flag already-used QRs.
  const [activeTicket, setActiveTicket] = useState<{
    code: string
    lastScanAt: string | null
  } | null>(null)

  // Collapsible open states
  const defaultLocalOpen = isLocalResident ? localProducts.length > 0 : false
  const defaultCommonOpen = isLocalResident ? localProducts.length === 0 : true
  const [localOpen, setLocalOpen] = useState(defaultLocalOpen)
  const [commonOpen, setCommonOpen] = useState(defaultCommonOpen)

  const handleEditAttendee = () => {
    handleEdit(attendee)
  }

  const handleSubmit = async (data: AttendeePassState) => {
    try {
      if (modal.isDelete) {
        await removeAttendee(attendee.id ?? "")
      } else {
        await editAttendee(attendee.id ?? "", {
          name: data.name ?? "",
          email: data.email ?? "",
          gender: data.gender ?? "",
          additional_data: data.additional_data,
        })
      }
    } catch (_error) {
      // El error ya se maneja en useAttendee con toast, solo aseguramos que el modal se cierre
    } finally {
      handleCloseModal()
    }
  }

  const handleRemoveAttendee = () => {
    handleDelete(attendee)
  }

  return (
    <div className="relative h-full w-full">
      <div className="w-full overflow-hidden">
        <div className="w-full rounded-3xl border border-border h-full lg:grid lg:grid-cols-[1fr_2px_2fr] bg-card">
          {/* Left panel - City & Attendee info */}
          <div className="relative flex flex-col p-6 overflow-hidden h-full min-h-[160px]">
            <div className="absolute inset-0 z-0 overflow-hidden rounded-t-3xl lg:rounded-l-3xl lg:rounded-tr-none">
              {city?.image_url && (
                <Image
                  src={city.image_url}
                  alt=""
                  fill
                  sizes="(max-width: 1024px) 100vw, 33vw"
                  className="object-cover object-top"
                  {...imageOptimization(city.image_url)}
                />
              )}
              {/* White fade over the photo, same gradient as before. */}
              <div
                className="absolute inset-0"
                style={{
                  background:
                    "linear-gradient(0deg, transparent, rgba(255, 255, 255, 0.8) 20%, rgb(255, 255, 255) 90%)",
                }}
              />
            </div>
            <div className="relative z-10 h-full flex flex-col justify-between">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-bold text-pass-title">
                    {city?.name}
                  </h2>
                  <p className="text-pass-text text-sm mt-1 lg:mt-2">
                    {attendee.name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5 lg:mt-1 text-pass-text text-sm">
                    <User className="w-3 h-3" />
                    <span>
                      {(badgeName as Record<string, string>)[
                        attendee.category ?? ""
                      ] || attendee.category}
                    </span>
                  </div>
                </div>
                {!isMainAttendee && (
                  <OptionsMenu
                    onEdit={handleEditAttendee}
                    onDelete={hasPurchased ? undefined : handleRemoveAttendee}
                    className="lg:hidden"
                  />
                )}
              </div>
            </div>
          </div>

          {/* Mobile horizontal divider with hole punches */}
          <div className="lg:hidden border-b-2 border-dashed border-border w-full relative">
            <div className="absolute -top-[23px] -left-[23px] w-[48px] h-[46px] bg-[#F5F5F7] rounded-full" />
            <div className="absolute -top-[23px] -right-[23px] w-[48px] h-[46px] bg-[#F5F5F7] rounded-full" />
          </div>

          {/* Desktop vertical divider with hole punches */}
          <div className="hidden lg:block border-r-2 border-dashed border-border self-stretch relative">
            <div className="absolute -top-[23px] -left-[23px] w-[48px] h-[46px] bg-background rounded-full" />
            <div className="absolute -bottom-[23px] -left-[23px] w-[48px] h-[46px] bg-background rounded-full" />
          </div>

          {/* Right panel */}
          <div
            className={cn(
              "relative flex flex-col gap-2 lg:pr-10 lg:min-h-[200px]",
              !toggleProduct && !hasPurchased
                ? "items-center justify-center text-center py-4 px-5 lg:p-8"
                : "items-start justify-start p-5 lg:p-8",
            )}
          >
            {/* Options menu - desktop only */}
            {!hasPurchased && !isMainAttendee && (
              <OptionsMenu
                onEdit={handleEditAttendee}
                onDelete={handleRemoveAttendee}
                className="absolute top-6 right-6 hidden lg:flex"
              />
            )}

            {standardProducts.length === 0 ? (
              <p className="text-sm font-medium text-neutral-500">
                {t("passes.coming_soon")}
              </p>
            ) : !toggleProduct && !hasPurchased ? (
              /* View mode - no purchased passes */
              <p className="text-pass-text max-w-xs lg:max-w-sm leading-relaxed">
                {t("passes.no_passes_yet_prefix", { city: city?.name })}{" "}
                <button
                  type="button"
                  onClick={onSwitchToBuy}
                  className="font-bold text-pass-title hover:underline cursor-pointer"
                >
                  {t("passes.buy_passes")}
                </button>{" "}
                {t("passes.no_passes_yet_suffix")}
              </p>
            ) : !toggleProduct && hasPurchased ? (
              /* View mode - with purchased passes - flat list by category + inline QR */
              <div className="w-full">
                {ticketEntries.map((entry, idx) => {
                  const CategoryIcon = getCategoryIcon(entry.product_category)
                  const isScanned = entry.last_scan_at != null
                  return (
                    <div
                      key={entry.id}
                      className={cn(
                        "flex items-center gap-2 py-3",
                        idx !== ticketEntries.length - 1 &&
                          "border-b border-dotted border-border",
                      )}
                    >
                      <CategoryIcon className="w-4 h-4 lg:w-5 lg:h-5 text-pass-text flex-shrink-0" />
                      <div className="flex items-baseline gap-1.5 flex-1 min-w-0">
                        <span className="font-bold text-pass-title text-sm lg:text-base whitespace-nowrap">
                          {entry.product_name}
                        </span>
                      </div>
                      {mealPlanIds.has(entry.product_id) &&
                        isMealPlanEntryEditable(entry) && (
                          <button
                            type="button"
                            onClick={() => setEditingEntryId(entry.id)}
                            aria-label="Edit meal plan"
                            className="flex items-center gap-1 text-xs font-medium text-pass-text hover:text-pass-title transition-colors cursor-pointer flex-shrink-0"
                          >
                            <Pencil className="w-4 h-4" />
                            <span className="hidden sm:inline">
                              Edit meal plan
                            </span>
                          </button>
                        )}
                      {entry.requires_check_in === true && (
                        <button
                          type="button"
                          onClick={() =>
                            setActiveTicket({
                              code: entry.check_in_code,
                              lastScanAt: entry.last_scan_at ?? null,
                            })
                          }
                          aria-label={
                            isScanned
                              ? t("passes.qr_already_scanned")
                              : t("passes.check_in_code")
                          }
                          className={cn(
                            "transition-colors cursor-pointer flex-shrink-0",
                            isScanned
                              ? "text-yellow-500 hover:text-yellow-700"
                              : "text-pass-text hover:text-pass-title",
                          )}
                        >
                          <QrCode className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                  )
                })}
                <QRcode
                  check_in_code={activeTicket?.code ?? ""}
                  lastScanAt={activeTicket?.lastScanAt ?? null}
                  isOpen={activeTicket !== null}
                  onOpenChange={(open) => {
                    if (!open) setActiveTicket(null)
                  }}
                />
              </div>
            ) : (
              /* Buy mode - collapsible sections */
              <div className="flex flex-col gap-3 w-full">
                {localProducts.length > 0 && (
                  <Collapsible
                    open={localOpen}
                    onOpenChange={setLocalOpen}
                    className="space-y-2"
                  >
                    <CollapsibleTrigger
                      className="w-full bg-accent rounded-md"
                      aria-label={t("passes.toggle_local_tickets")}
                    >
                      <div className="flex justify-between items-center p-3">
                        <div className="flex items-center gap-2">
                          <ChevronRight
                            className={cn(
                              "h-4 w-4 transition-transform duration-200",
                              localOpen && "transform rotate-90",
                            )}
                          />
                          <span className="font-medium">
                            {t("passes.latam_citizens")}
                          </span>
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="transition-all duration-100 ease-in-out data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown">
                      <div className="flex flex-col gap-2">
                        {localProducts.map((product, index) => {
                          const hasDayInCommon = localProducts.some(
                            (p) => p.duration_type === "day",
                          )
                          const firstDayIndexCommon = localProducts.findIndex(
                            (p) => p.duration_type === "day",
                          )

                          return (
                            <React.Fragment
                              key={`${product.id}-${attendee.id}`}
                            >
                              {index === firstDayIndexCommon &&
                                hasDayInCommon &&
                                !isDayCheckout && (
                                  <Separator className="my-1" />
                                )}
                              <Product
                                product={product}
                                defaultDisabled={!toggleProduct}
                                hasMonthPurchased={hasMonthPurchased}
                                onClick={
                                  toggleProduct
                                    ? (attendeeId, product) =>
                                        toggleProduct(attendeeId ?? "", product)
                                    : () => {}
                                }
                              />
                              {product.duration_type === "month" && (
                                <Separator className="my-1" />
                              )}
                            </React.Fragment>
                          )
                        })}
                      </div>
                      <p className="text-sm font-medium text-neutral-500 text-right mt-2">
                        {t("passes.id_required")}
                      </p>
                    </CollapsibleContent>
                  </Collapsible>
                )}

                {commonProducts.length > 0 && (
                  <Collapsible
                    open={commonOpen}
                    onOpenChange={setCommonOpen}
                    className="space-y-2"
                  >
                    <CollapsibleTrigger
                      className="w-full bg-accent rounded-md"
                      aria-label={t("passes.toggle_common_tickets")}
                    >
                      <div className="flex justify-between items-center p-3">
                        <div className="flex items-center gap-2">
                          <ChevronRight
                            className={cn(
                              "h-4 w-4 transition-transform duration-200",
                              commonOpen && "transform rotate-90",
                            )}
                          />
                          <span className="font-medium">
                            {t("passes.standard")}
                          </span>
                        </div>
                      </div>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="transition-all duration-100 ease-in-out data-[state=closed]:animate-slideUp data-[state=open]:animate-slideDown">
                      <div className="flex flex-col gap-2">
                        {(() => {
                          const hasDayInCommon = commonProducts.some(
                            (p) => p.duration_type === "day",
                          )
                          const firstDayIndexCommon = commonProducts.findIndex(
                            (p) => p.duration_type === "day",
                          )
                          return commonProducts.map((product, index) => (
                            <React.Fragment
                              key={`${product.id}-${attendee.id}`}
                            >
                              {index === firstDayIndexCommon &&
                                hasDayInCommon &&
                                !isDayCheckout && (
                                  <Separator className="my-1" />
                                )}
                              <Product
                                product={product}
                                defaultDisabled={!toggleProduct}
                                hasMonthPurchased={hasMonthPurchased}
                                onClick={
                                  toggleProduct
                                    ? (attendeeId, product) =>
                                        toggleProduct(attendeeId ?? "", product)
                                    : () => {}
                                }
                              />
                              {product.duration_type === "month" && (
                                <Separator className="my-1" />
                              )}
                            </React.Fragment>
                          ))
                        })()}
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {modal.isOpen && modal.category && (
        <AttendeeModal
          open={modal.isOpen}
          onClose={handleCloseModal}
          onSubmit={handleSubmit}
          category={modal.category}
          editingAttendee={modal.editingAttendee}
          isDelete={modal.isDelete}
        />
      )}

      {editingEntryId && (
        <MealPlanEditModal
          open={!!editingEntryId}
          onClose={() => setEditingEntryId(null)}
          attendee={attendee}
          mealPlanEntries={mealPlanEntries.filter(
            (e) => e.id === editingEntryId,
          )}
          templateConfig={mealPlanTemplateConfig}
          products={products}
        />
      )}
    </div>
  )
}

export default AttendeeTicket
