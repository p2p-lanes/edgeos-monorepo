import { CircleUser, CreditCard, MapPin, X } from "lucide-react"
import Image from "next/image"
import { type ReactNode, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import QRCodeReact from "react-qr-code"
import { Drawer as DrawerPrimitive } from "vaul"
import { PaymentFormResponses } from "@/components/payments/PaymentFormResponses"
import ExpandableDescription from "@/components/ui/ExpandableDescription"
import { useIsMobile } from "@/hooks/useIsMobile"
import { imageOptimization } from "@/lib/image-optimization"
import { formatRelative } from "@/lib/relativeTime"
import { cn } from "@/lib/utils"
import type { TicketEntry } from "@/types/Attendee"
import { formatCheckoutDate, formatCurrency } from "@/types/checkout"
import {
  type BookingSummary,
  parseBooking,
} from "../../utils/accommodationBooking"

/** Half the screen first, the whole screen once the reader pulls it up. */
const SNAP_POINTS = [0.62, 1]

interface PurchasedProductSheetProps {
  /** The purchase shown; null keeps the sheet closed. */
  entry: TicketEntry | null
  imageUrl: string | null
  attendeeName?: string | null
  onClose: () => void
}

/**
 * Everything about one purchase, opened from its row on the passes page.
 *
 * A bottom sheet on phones, so it can open at half height over the list and
 * be pulled up to read a long description; a side panel on desktop, where the
 * ticket stays in view beside it. The check-in QR is drawn here at a size a
 * gate scanner reads, so the sheet never needs a second dialog on top.
 */
const PurchasedProductSheet = ({
  entry,
  imageUrl,
  attendeeName,
  onClose,
}: PurchasedProductSheetProps) => {
  const isMobile = useIsMobile()
  const [snap, setSnap] = useState<number | string | null>(SNAP_POINTS[0])
  const open = entry !== null

  // Every purchase opens at half height, whatever the last one was left at.
  useEffect(() => {
    if (open) setSnap(SNAP_POINTS[0])
  }, [open])

  const fullHeight = !isMobile || snap === SNAP_POINTS[SNAP_POINTS.length - 1]

  // vaul types snap points and fadeFromIndex as one unit, so each layout
  // passes a complete set of its own.
  const layoutProps = isMobile
    ? ({
        direction: "bottom",
        snapPoints: SNAP_POINTS,
        activeSnapPoint: snap,
        setActiveSnapPoint: setSnap,
        // Dim the page from the half-height stop, not only at the top.
        fadeFromIndex: 0,
      } as const)
    : ({ direction: "right" } as const)

  return (
    <DrawerPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
      shouldScaleBackground={false}
      {...layoutProps}
    >
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45" />
        <DrawerPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden bg-card outline-none",
            isMobile
              ? "inset-x-0 bottom-0 h-full max-h-[96dvh] rounded-t-3xl"
              : "inset-y-0 right-0 h-full w-[440px] max-w-full border-l border-border shadow-2xl",
          )}
        >
          {entry && (
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col",
                fullHeight ? "overflow-y-auto" : "overflow-hidden",
              )}
            >
              <SheetBody
                entry={entry}
                imageUrl={imageUrl}
                attendeeName={attendeeName}
                showHandle={isMobile}
                fullHeight={fullHeight}
                onExpandDescription={() => {
                  if (isMobile) setSnap(SNAP_POINTS[SNAP_POINTS.length - 1])
                }}
              />
            </div>
          )}
        </DrawerPrimitive.Content>
      </DrawerPrimitive.Portal>
    </DrawerPrimitive.Root>
  )
}

const SheetBody = ({
  entry,
  imageUrl,
  attendeeName,
  showHandle,
  fullHeight,
  onExpandDescription,
}: {
  entry: TicketEntry
  imageUrl: string | null
  attendeeName?: string | null
  showHandle: boolean
  /** Desktop, or a phone sheet pulled all the way up: no need to clamp. */
  fullHeight: boolean
  onExpandDescription: () => void
}) => {
  const { t } = useTranslation()
  const booking = parseBooking(entry)
  const description = entry.product_description?.trim() ?? ""
  const title = booking?.accommodationName ?? entry.product_name ?? ""

  const closeButton = (
    <DrawerPrimitive.Close
      aria-label={t("passes.purchase_details_close")}
      className={cn(
        "grid size-9 cursor-pointer place-items-center rounded-full text-pass-title transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        imageUrl ? "bg-white/90 hover:bg-white" : "bg-muted hover:bg-muted/70",
      )}
    >
      <X className="size-4" />
    </DrawerPrimitive.Close>
  )

  return (
    <>
      {imageUrl ? (
        <div className="relative h-48 flex-shrink-0 overflow-hidden bg-muted lg:h-56">
          <Image
            src={imageUrl}
            alt=""
            fill
            sizes="(max-width: 1024px) 100vw, 440px"
            className="object-cover"
            {...imageOptimization(imageUrl)}
          />
          {showHandle && (
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-white/90 shadow-sm ring-1 ring-black/10"
            />
          )}
          <div className="absolute right-3 top-3">{closeButton}</div>
        </div>
      ) : (
        <div className="relative flex flex-shrink-0 justify-end px-3 pt-3">
          {showHandle && (
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-border"
            />
          )}
          {closeButton}
        </div>
      )}

      <div
        className="flex flex-col gap-4 px-5 pt-4 lg:px-7"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        <div className="flex flex-col gap-1">
          {booking?.propertyName && (
            <span className="text-sm text-pass-text">
              {booking.propertyName}
            </span>
          )}
          <DrawerPrimitive.Title className="flex flex-wrap items-baseline gap-x-2 text-2xl font-bold leading-tight tracking-tight text-pass-title">
            <span className="break-words">{title}</span>
            {booking?.unitLabel && (
              <span className="text-sm font-normal text-pass-text">
                {booking.unitLabel}
              </span>
            )}
          </DrawerPrimitive.Title>
          {attendeeName && !booking && (
            <span className="text-sm text-pass-text">{attendeeName}</span>
          )}
        </div>

        {entry.requires_check_in === true && <CheckInCode entry={entry} />}

        {booking && <StayDetails booking={booking} />}

        {entry.payment_id && (
          <PaymentFormResponses paymentId={entry.payment_id} />
        )}

        {description && fullHeight && (
          <p className="whitespace-pre-line break-words text-[15px] leading-relaxed text-pass-text">
            {description}
          </p>
        )}
        {description && !fullHeight && (
          <ExpandableDescription
            text={description}
            clamp={6}
            onToggle={(expanded) => {
              if (expanded) onExpandDescription()
            }}
            className="whitespace-pre-line break-words text-[15px] leading-relaxed text-pass-text"
            buttonClassName="text-sm font-semibold text-pass-title hover:text-pass-title"
          />
        )}
      </div>
    </>
  )
}

const CheckInCode = ({ entry }: { entry: TicketEntry }) => {
  const { t, i18n } = useTranslation()
  const scannedAt = entry.last_scan_at ?? null

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-border p-3">
      <div className="flex-shrink-0 rounded-lg bg-white p-1.5">
        <div className="w-28">
          <QRCodeReact
            value={JSON.stringify({ code: entry.check_in_code })}
            size={112}
            level="H"
            style={{ width: "100%", height: "auto" }}
          />
        </div>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[15px] font-bold text-pass-title">
          {t("passes.check_in_code")}
        </span>
        <span className="font-mono text-sm tracking-wider text-pass-title">
          {entry.check_in_code}
        </span>
        {scannedAt ? (
          <span className="flex items-center gap-1.5 text-xs font-medium text-yellow-700">
            <span className="size-1.5 rounded-full bg-yellow-500" />
            {t("passes.qr_already_scanned")} ·{" "}
            {formatRelative(scannedAt, i18n.language)}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
            <span className="size-1.5 rounded-full bg-current" />
            {t("passes.other_product_ready")}
          </span>
        )}
      </div>
    </div>
  )
}

const StayDetails = ({ booking }: { booking: BookingSummary }) => {
  const { t } = useTranslation()
  const guestLine =
    booking.guests.length > 0
      ? booking.guests.join(", ")
      : booking.guestCount
        ? t("checkout.accommodation.guests", { count: booking.guestCount })
        : null

  return (
    <div className="flex flex-col gap-1">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-2xl bg-muted px-4 py-3">
        <div className="flex flex-col">
          <span className="text-[11px] uppercase tracking-wider text-pass-text">
            {t("checkout.accommodation.check_in")}
          </span>
          <span className="text-base font-bold text-pass-title">
            {formatCheckoutDate(booking.checkIn)}
          </span>
        </div>
        {booking.nights ? (
          <span className="rounded-full border border-border bg-card px-2.5 py-1 text-xs font-semibold text-pass-title">
            {t("checkout.accommodation.nights", { count: booking.nights })}
          </span>
        ) : (
          <span aria-hidden="true" className="text-pass-text">
            →
          </span>
        )}
        <div className="flex flex-col text-right">
          <span className="text-[11px] uppercase tracking-wider text-pass-text">
            {t("checkout.accommodation.check_out")}
          </span>
          <span className="text-base font-bold text-pass-title">
            {formatCheckoutDate(booking.checkOut)}
          </span>
        </div>
      </div>

      <div className="flex flex-col divide-y divide-border">
        {guestLine && (
          <DetailLine
            icon={CircleUser}
            label={t("checkout.accommodation.guests_label")}
          >
            {guestLine}
          </DetailLine>
        )}
        {booking.propertyAddress && (
          <DetailLine icon={MapPin} label={t("passes.purchase_address")}>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(booking.propertyAddress)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-pass-title"
            >
              {booking.propertyAddress}
            </a>
          </DetailLine>
        )}
        {booking.total && (
          <DetailLine icon={CreditCard} label={t("passes.purchase_total_paid")}>
            <span className="font-semibold">
              {formatCurrency(
                Number(booking.total),
                booking.currency ?? undefined,
              )}
            </span>
          </DetailLine>
        )}
      </div>
    </div>
  )
}

const DetailLine = ({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof MapPin
  label: string
  children: ReactNode
}) => (
  <div className="flex items-start gap-3 py-3">
    <Icon
      aria-hidden="true"
      className="mt-0.5 size-4 flex-shrink-0 text-pass-text"
    />
    <div className="flex min-w-0 flex-col gap-0.5 text-[15px] text-pass-title">
      <span className="text-xs text-pass-text">{label}</span>
      <span className="break-words">{children}</span>
    </div>
  </div>
)

export default PurchasedProductSheet
