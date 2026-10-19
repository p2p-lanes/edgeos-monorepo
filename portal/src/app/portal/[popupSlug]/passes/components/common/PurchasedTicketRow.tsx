import { BedDouble, ChevronRight, Pencil, QrCode } from "lucide-react"
import Image from "next/image"
import { useTranslation } from "react-i18next"
import { imageOptimization } from "@/lib/image-optimization"
import { cn } from "@/lib/utils"
import type { TicketEntry } from "@/types/Attendee"
import { formatCheckoutDate, formatCurrency } from "@/types/checkout"
import { parseBooking } from "../../utils/accommodationBooking"
import { getCategoryIcon } from "../../utils/categoryDisplay"

interface PurchasedTicketRowProps {
  entry: TicketEntry
  /** The product's image, else the image of the checkout card it sold under. */
  imageUrl: string | null
  onOpen: () => void
  onEditMealPlan?: () => void
  onShowQr?: () => void
}

/**
 * One purchase in the ticket's list, closed: a picture, a name and one line
 * of context. Everything else lives in the detail sheet the row opens, so a
 * long description or a booked stay never stretches the ticket.
 */
const PurchasedTicketRow = ({
  entry,
  imageUrl,
  onOpen,
  onEditMealPlan,
  onShowQr,
}: PurchasedTicketRowProps) => {
  const { t } = useTranslation()
  const booking = parseBooking(entry)
  const isScanned = entry.last_scan_at != null
  const Icon = booking ? BedDouble : getCategoryIcon(entry.product_category)

  const title = booking?.accommodationName ?? entry.product_name
  const subtitle = booking
    ? [
        booking.propertyName,
        `${formatCheckoutDate(booking.checkIn)} → ${formatCheckoutDate(booking.checkOut)}`,
        booking.nights
          ? t("checkout.accommodation.nights", { count: booking.nights })
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : entry.product_description?.trim().split("\n")[0] ||
      (isScanned ? t("passes.qr_already_scanned") : null)
  const price = booking?.total
    ? formatCurrency(Number(booking.total), booking.currency ?? undefined)
    : null

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onOpen}
        aria-haspopup="dialog"
        className="group flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-xl py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {imageUrl ? (
          <div className="relative size-11 flex-shrink-0 overflow-hidden rounded-xl bg-muted lg:size-12">
            <Image
              src={imageUrl}
              alt=""
              fill
              sizes="48px"
              className="object-cover"
              {...imageOptimization(imageUrl)}
            />
          </div>
        ) : (
          <div className="grid size-11 flex-shrink-0 place-items-center rounded-xl bg-muted lg:size-12">
            <Icon className="size-5 text-pass-text" />
          </div>
        )}

        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5">
            <span className="break-words text-sm font-bold text-pass-title lg:text-base">
              {title}
            </span>
            {booking?.unitLabel && (
              <span className="text-xs text-pass-text">
                {booking.unitLabel}
              </span>
            )}
          </span>
          {subtitle && (
            <span className="truncate text-xs text-pass-text lg:text-sm">
              {subtitle}
            </span>
          )}
        </span>

        {price && (
          <span className="flex-shrink-0 text-sm font-medium text-pass-title">
            {price}
          </span>
        )}
        <ChevronRight
          aria-hidden="true"
          className="size-4 flex-shrink-0 text-pass-text transition-colors group-hover:text-pass-title"
        />
      </button>

      {onEditMealPlan && (
        <button
          type="button"
          onClick={onEditMealPlan}
          aria-label="Edit meal plan"
          className="grid size-10 flex-shrink-0 cursor-pointer place-items-center rounded-xl text-pass-text transition-colors hover:text-pass-title"
        >
          <Pencil className="size-4" />
        </button>
      )}
      {onShowQr && (
        <button
          type="button"
          onClick={onShowQr}
          aria-label={
            isScanned
              ? t("passes.qr_already_scanned")
              : t("passes.check_in_code")
          }
          className={cn(
            "grid size-10 flex-shrink-0 cursor-pointer place-items-center rounded-xl border border-border transition-colors",
            isScanned
              ? "text-yellow-500 hover:text-yellow-700"
              : "text-pass-title hover:bg-muted",
          )}
        >
          <QrCode className="size-5" />
        </button>
      )}
    </div>
  )
}

export default PurchasedTicketRow
