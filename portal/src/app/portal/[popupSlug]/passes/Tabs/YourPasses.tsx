import { ArrowRight, FileText, Plus, Sparkles, Ticket } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { TICKET_CATEGORY } from "@/checkout/popupCheckoutPolicy"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import useAttendee from "@/hooks/useAttendee"
import { cn } from "@/lib/utils"
import { useApplication } from "@/providers/applicationProvider"
import { useCityProvider } from "@/providers/cityProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import type { AttendeePassState } from "@/types/Attendee"
import { formatCurrency } from "@/types/checkout"
import { AttendeeModal } from "../components/AttendeeModal"
import AttendeeTicket from "../components/common/AttendeeTicket"
import InvoiceModal from "../components/common/InvoiceModal"
import Special from "../components/common/Products/Special"
import useModal from "../hooks/useModal"

interface YourPassesProps {
  onSwitchToBuy: () => void
}

const YourPasses = ({ onSwitchToBuy }: YourPassesProps) => {
  const { t } = useTranslation()
  const { attendeePasses: attendees, products } = usePassesProvider()
  const mainAttendee = attendees.find((a) => a.category === "main")
  const specialProduct = mainAttendee?.products.find(
    (p) => p.category === "patreon",
  )
  const searchParams = useSearchParams()
  const isDayCheckout = searchParams.has("day-passes")
  const { getCity } = useCityProvider()
  const city = getCity()
  const { getAttendees } = useApplication()
  const applicationAttendees = getAttendees()
  const hasSpouse = applicationAttendees.some((a) => a.category === "spouse")
  const { handleOpenModal, handleCloseModal, modal } = useModal()
  const { addAttendee } = useAttendee()
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false)

  const hasPurchasedPasses = attendees.some((a) =>
    a.products.some((p) => p.purchased),
  )

  const mainTickets = products.filter(
    (p) =>
      p.category === TICKET_CATEGORY &&
      p.attendee_category === "main" &&
      p.is_active !== false,
  )
  const minPrice =
    mainTickets.length > 0 ? Math.min(...mainTickets.map((p) => p.price)) : null

  const handleSubmit = async (data: AttendeePassState) => {
    if (modal.category) {
      await addAttendee({
        name: data.name ?? "",
        email: data.email ?? "",
        category: modal.category,
        gender: data.gender ?? "",
      })
    }
    handleCloseModal()
  }

  return (
    <div className="space-y-6 pb-24 lg:pb-0">
      {/* Heading with Ticket Icon */}
      <div className="flex flex-col gap-2 max-w-3xl">
        <div className="flex items-center gap-3">
          <Ticket className="w-6 h-6 text-pass-text" />
          <h1 className="text-3xl font-bold tracking-tight text-pass-title">
            {t("passes.your_passes")}
          </h1>
        </div>
        <p className="text-pass-text">{t("passes.your_passes_description")}</p>

        {/* Inline Text Links */}
        <div className="flex flex-wrap items-center gap-3 text-sm mt-2">
          {city?.allows_spouse && (
            <>
              <button
                type="button"
                className={cn(
                  "flex items-center gap-1.5 transition-colors whitespace-nowrap group",
                  hasSpouse
                    ? "text-gray-300 cursor-not-allowed"
                    : "text-pass-text hover:text-pass-title",
                )}
                onClick={() => !hasSpouse && handleOpenModal("spouse")}
                disabled={!applicationAttendees.length || hasSpouse}
              >
                <div
                  className={cn(
                    "p-0.5 rounded-full transition-colors",
                    hasSpouse ? "bg-muted" : "bg-muted group-hover:bg-muted",
                  )}
                >
                  <Plus className="w-3 h-3" />
                </div>
                <span>{t("passes.add_spouse")}</span>
              </button>
              <span className="text-gray-300">|</span>
            </>
          )}
          {city?.allows_children && (
            <>
              <button
                type="button"
                className="flex items-center gap-1.5 text-pass-text hover:text-pass-title transition-colors whitespace-nowrap group"
                onClick={() => handleOpenModal("kid")}
                disabled={!applicationAttendees.length}
              >
                <div className="bg-muted p-0.5 rounded-full group-hover:bg-muted transition-colors">
                  <Plus className="w-3 h-3" />
                </div>
                <span>{t("passes.add_children")}</span>
              </button>
              <span className="text-gray-300">|</span>
            </>
          )}
          {city?.invoice_company_name && (
            <button
              type="button"
              className="flex items-center gap-1.5 text-pass-text hover:text-pass-title transition-colors whitespace-nowrap"
              onClick={() => setIsInvoiceModalOpen(true)}
            >
              <FileText className="w-3.5 h-3.5" />
              <span>{t("passes.view_invoices")}</span>
            </button>
          )}
        </div>
      </div>

      {specialProduct && (
        <div className="p-0 w-full">
          <Special product={specialProduct} disabled />
          <Separator className="my-4" />
        </div>
      )}

      <div className="flex flex-col gap-4">
        {attendees.length === 0 ? (
          <>
            <Skeleton className="w-full h-[300px] rounded-3xl" />
            <Skeleton className="w-full h-[300px] rounded-3xl" />
            <Skeleton className="w-full h-[300px] rounded-3xl" />
          </>
        ) : (
          attendees.map((attendee) => (
            <AttendeeTicket
              key={attendee.id}
              attendee={attendee}
              isDayCheckout={isDayCheckout}
              onSwitchToBuy={onSwitchToBuy}
            />
          ))
        )}
      </div>

      {/* Desktop CTA Card */}
      <div className="hidden lg:block mt-6">
        {!hasPurchasedPasses ? (
          <div
            className="rounded-3xl overflow-hidden shadow-xl relative"
            style={{
              boxShadow: "0 15px 40px -12px rgba(0, 0, 0, 0.3)",
            }}
          >
            <div
              className="absolute inset-0 z-0"
              style={{
                background:
                  "linear-gradient(135deg, rgba(17, 24, 39, 0.97) 0%, rgba(31, 41, 55, 0.95) 100%)",
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-br from-indigo-600/10 via-transparent to-purple-600/10" />

            {/* Hero CTA sits on a fixed dark gradient (lines above) that is
                intentional brand art, not derived from the theme. Text and
                the pill button stay on literal white/neutral so contrast
                holds regardless of the popup's light/dark mode. */}
            <div className="relative z-10 p-6">
              <div className="flex items-center justify-between gap-5">
                <div className="flex-1 min-w-0">
                  <div className="inline-flex items-center gap-2 bg-white/10 backdrop-blur-sm px-2.5 py-1 rounded-full mb-3">
                    <Sparkles className="w-3.5 h-3.5 text-yellow-400" />
                    <span className="text-xs text-white/90 font-medium">
                      {t("passes.people_registered")}
                    </span>
                  </div>
                  <h3 className="text-white font-bold text-2xl">
                    {t("passes.adventure_awaits")}
                  </h3>
                  <p className="text-gray-300 text-sm mt-1 max-w-md">
                    {t("passes.village_subtitle")}
                  </p>
                </div>
                <div className="flex flex-col gap-1.5 flex-shrink-0">
                  <Button
                    onClick={onSwitchToBuy}
                    className="flex items-center justify-center gap-2 bg-white hover:bg-gray-100 text-gray-900 px-8 py-4 h-auto rounded-xl text-base font-bold transition-all shadow-xl whitespace-nowrap active:scale-95"
                  >
                    {t("passes.get_your_pass")}
                    <ArrowRight className="w-5 h-5" />
                  </Button>
                  {minPrice != null && (
                    <p className="text-center text-gray-300 text-xs">
                      {t("passes.starting_at", {
                        price: formatCurrency(minPrice),
                      })}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-card rounded-2xl shadow-sm border border-border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-pass-title font-medium">
                  {t("passes.need_more_passes")}
                </p>
                <p className="text-pass-text text-xs mt-0.5">
                  {t("passes.add_family_or_weeks")}
                </p>
              </div>
              <Button
                onClick={onSwitchToBuy}
                className="flex items-center gap-2 bg-foreground hover:bg-foreground text-background px-5 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap active:scale-95"
              >
                {t("passes.buy_passes")}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Sticky Footer — same fixed-dark treatment as the desktop
          hero above: the footer stays dark regardless of theme, so its
          text and the pill button use literal white/neutral. */}
      <div className="fixed bottom-0 left-0 right-0 z-30 lg:hidden">
        {!hasPurchasedPasses ? (
          <div className="bg-gray-900 border-t border-gray-800 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <Sparkles className="w-3 h-3 text-yellow-400" />
                  <span className="text-xs text-gray-400 font-medium">
                    {t("passes.builders_registered")}
                  </span>
                </div>
                <p className="text-white font-semibold text-sm">
                  {t("passes.adventure_awaits")}
                </p>
              </div>
              <Button
                onClick={onSwitchToBuy}
                className="flex items-center justify-center gap-1.5 bg-white hover:bg-gray-100 text-gray-900 px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg whitespace-nowrap active:scale-95"
              >
                {t("passes.buy")}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        ) : (
          <div className="bg-card border-t border-border px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-pass-title font-semibold text-sm">
                  {t("passes.need_more_passes")}
                </p>
                <p className="text-pass-text text-xs mt-0.5">
                  {t("passes.add_family_or_weeks")}
                </p>
              </div>
              <Button
                onClick={onSwitchToBuy}
                className="flex items-center justify-center gap-1.5 bg-foreground hover:bg-foreground text-background px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg whitespace-nowrap active:scale-95"
              >
                {t("passes.buy")}
                <ArrowRight className="w-4 h-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      {modal.isOpen && (
        <AttendeeModal
          open={modal.isOpen}
          onClose={handleCloseModal}
          onSubmit={handleSubmit}
          category={modal.category!}
          editingAttendee={modal.editingAttendee}
        />
      )}
      {city?.invoice_company_name && (
        <InvoiceModal
          isOpen={isInvoiceModalOpen}
          onClose={() => setIsInvoiceModalOpen(false)}
        />
      )}
    </div>
  )
}
export default YourPasses
