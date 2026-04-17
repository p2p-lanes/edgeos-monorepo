import { ChevronRight, QrCode, Ticket, User } from "lucide-react"
import React, { useState } from "react"
import { useTranslation } from "react-i18next"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"
import useAttendee from "@/hooks/useAttendee"
import { cn } from "@/lib/utils"
import { useCityProvider } from "@/providers/cityProvider"
import type { AttendeePassState } from "@/types/Attendee"
import type { ProductsPass } from "@/types/Products"
import { badgeName } from "../../constants/multiuse"
import useModal from "../../hooks/useModal"
import { AttendeeModal } from "../AttendeeModal"
import OptionsMenu from "./Buttons/OptionsMenu"
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
        (isDayCheckout ? product.duration_type === "day" : true),
    )
    .sort(sortProductsByPriority)
  const { getCity } = useCityProvider()
  const city = getCity()
  const { handleEdit, handleCloseModal, modal, handleDelete } = useModal()
  const { removeAttendee, editAttendee } = useAttendee()
  const hasPurchased = attendee.products.some((product) => product.purchased)
  const [isQrModalOpen, setIsQrModalOpen] = useState(false)

  const hasMonthPurchased = attendee.products.some(
    (product) =>
      (product.duration_type === "month" || product.duration_type === "full") &&
      (product.purchased || product.selected),
  )
  // LEGACY: application.local_resident was removed from API
  const isLocalResident = false

  // All ticket products go into commonProducts (local categories no longer exist)
  const localProducts: ProductsPass[] = []
  const commonProducts = standardProducts.filter((p) => p.category === "ticket")

  // Get purchased passes for view mode display
  const purchasedPasses = attendee.products
    .filter((product) => {
      if (!product.purchased || product.category === "patreon") return false
      if (
        hasMonthPurchased &&
        (product.duration_type === "week" || product.duration_type === "day")
      )
        return false
      return true
    })
    .sort(sortProductsByPriority)

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
          category: (data.category ??
            "main") as import("@/types/Attendee").AttendeeCategory,
          gender: data.gender ?? "",
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

  const handleOpenQrModal = () => {
    setIsQrModalOpen(true)
  }

  return (
    <div className="relative h-full w-full">
      <div className="w-full overflow-hidden">
        <div className="w-full rounded-3xl border border-gray-200 h-full lg:grid lg:grid-cols-[1fr_2px_2fr] bg-white">
          {/* Left panel - City & Attendee info */}
          <div className="relative flex flex-col p-6 overflow-hidden h-full min-h-[160px]">
            <div
              className="absolute inset-0 z-0 rounded-t-3xl lg:rounded-l-3xl lg:rounded-tr-none"
              style={{
                background: city?.image_url
                  ? `linear-gradient(0deg, transparent, rgba(255, 255, 255, 0.8) 20%, rgb(255, 255, 255) 90%) center top / cover, url(${city.image_url}) center top / cover`
                  : "linear-gradient(0deg, transparent, rgba(255, 255, 255, 0.8) 20%, rgb(255, 255, 255) 90%)",
              }}
            />
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
                <OptionsMenu
                  onEdit={handleEditAttendee}
                  onDelete={hasPurchased ? undefined : handleRemoveAttendee}
                  className="lg:hidden"
                />
              </div>
            </div>
          </div>

          {/* Mobile horizontal divider with hole punches */}
          <div className="lg:hidden border-b-2 border-dashed border-gray-200 w-full relative">
            <div className="absolute -top-[23px] -left-[23px] w-[48px] h-[46px] bg-[#F5F5F7] rounded-full" />
            <div className="absolute -top-[23px] -right-[23px] w-[48px] h-[46px] bg-[#F5F5F7] rounded-full" />
          </div>

          {/* Desktop vertical divider with hole punches */}
          <div className="hidden lg:block border-r-2 border-dashed border-gray-200 self-stretch relative">
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
            {!hasPurchased && (
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
              /* View mode - with purchased passes - simple pass list */
              <>
                <div className="w-full">
                  {purchasedPasses.map((pass, idx) => (
                    <div
                      key={`${pass.id}-${attendee.id}`}
                      className={cn(
                        "flex items-center gap-2 py-3",
                        idx !== purchasedPasses.length - 1 &&
                          "border-b border-dotted border-gray-300",
                      )}
                    >
                      <Ticket className="w-4 h-4 lg:w-5 lg:h-5 text-pass-text flex-shrink-0" />
                      <div className="flex items-baseline gap-1.5 flex-1 min-w-0">
                        <span className="font-bold text-pass-title text-sm lg:text-base whitespace-nowrap">
                          {pass.name}
                        </span>
                        {pass.start_date && pass.end_date && (
                          <span className="text-pass-text text-xs lg:text-sm truncate">
                            {new Date(pass.start_date).toLocaleDateString(
                              "en-US",
                              { month: "short", day: "numeric" },
                            )}{" "}
                            to{" "}
                            {new Date(pass.end_date).toLocaleDateString(
                              "en-US",
                              { month: "short", day: "numeric" },
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {/* Check-in code indicator */}
                <button
                  type="button"
                  onClick={handleOpenQrModal}
                  className="flex items-center gap-1.5 mt-3 justify-end lg:absolute lg:bottom-6 lg:right-6 lg:mt-0 text-xs font-medium text-pass-text uppercase tracking-wider hover:text-pass-title transition-colors cursor-pointer"
                >
                  <span>{t("passes.check_in_code")}</span>
                  <QrCode className="w-4 h-4" />
                </button>
              </>
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

      <AttendeeModal
        open={modal.isOpen}
        onClose={handleCloseModal}
        onSubmit={handleSubmit}
        category={modal.category!}
        editingAttendee={modal.editingAttendee}
        isDelete={modal.isDelete}
      />

      <QRcode
        check_in_code={attendee.check_in_code || ""}
        isOpen={isQrModalOpen}
        onOpenChange={setIsQrModalOpen}
      />
    </div>
  )
}

export default AttendeeTicket
