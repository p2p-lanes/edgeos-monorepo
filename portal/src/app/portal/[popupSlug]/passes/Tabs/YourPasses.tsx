import { useQuery } from "@tanstack/react-query"
import { ArrowRight, Sparkles } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { useTranslation } from "react-i18next"
import { TICKET_CATEGORY } from "@/checkout/popupCheckoutPolicy"
import { TicketingStepsService } from "@/client"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useAttendeeCategories } from "@/hooks/useAttendeeCategories"
import { useProductsQuery } from "@/hooks/useProductsQuery"
import { useCityProvider } from "@/providers/cityProvider"
import { usePassesProvider } from "@/providers/passesProvider"
import type { AttendeePassState } from "@/types/Attendee"
import { formatCurrency } from "@/types/checkout"
import AttendeeTicket from "../components/common/AttendeeTicket"

interface TicketSelectSectionConfig {
  product_ids?: string[]
  attendee_categories?: string[] | null
}

interface YourPassesProps {
  attendees?: AttendeePassState[]
  inlineCta?: boolean
  onSwitchToBuy?: (attendee?: AttendeePassState) => void
  readOnly?: boolean
  salesFlowId: string | null
  sectionTitle?: string
}

const YourPasses = ({
  attendees: attendeeSubset,
  inlineCta = false,
  onSwitchToBuy,
  readOnly = false,
  salesFlowId,
  sectionTitle,
}: YourPassesProps) => {
  const { t } = useTranslation()
  const { attendeePasses: providerAttendees } = usePassesProvider()
  const attendees = attendeeSubset ?? providerAttendees
  const flowPurchase = salesFlowId === null ? undefined : onSwitchToBuy
  const searchParams = useSearchParams()
  const isDayCheckout = searchParams.has("day-passes")
  const { getCity } = useCityProvider()
  const city = getCity()
  const { categories } = useAttendeeCategories(city?.id ? String(city.id) : "")
  const primaryCategoryId = categories?.find((c) => c.is_primary)?.id ?? null

  const hasPurchasedPasses = attendees.some(
    (attendee) =>
      attendee.products.some((product) => product.purchased) ||
      (attendee.ticket_entries ?? []).some(
        (entry) => entry.product_category !== "patreon",
      ),
  )

  // Product → main-attendee mapping lives in ticketing-step template_config
  // sections (see VariantTicketSelect.buildSectionGroups). Mirror that logic
  // here so the "Starting at" price reflects only what the main attendee can
  // actually buy. Products.attendee_category_id is not populated for popups
  // configured under the post-migration ticket-as-first-class-entity model,
  // so we don't fall back to it — that's what produced the $0 bug.
  const popupId = city?.id ? String(city.id) : null
  const { data: queriedProducts = [] } = useProductsQuery(
    popupId,
    salesFlowId,
    salesFlowId !== null,
  )
  const products = salesFlowId === null ? [] : queriedProducts
  const { data: queriedTicketingStepsData } = useQuery({
    queryKey: ["ticketing-steps-portal", popupId, salesFlowId],
    queryFn: () =>
      TicketingStepsService.listPortalTicketingSteps({
        popupId: popupId!,
        salesFlowId: salesFlowId!,
      }),
    enabled: !!popupId && salesFlowId !== null,
  })
  const ticketingStepsData =
    salesFlowId === null ? undefined : queriedTicketingStepsData

  const mainProductIds: Set<string> | null = (() => {
    if (!ticketingStepsData || primaryCategoryId == null) return null

    const ticketSelectStep = (ticketingStepsData.results ?? []).find(
      (s) => s.template === "ticket-select",
    )
    const sections = (ticketSelectStep?.template_config?.sections ??
      []) as TicketSelectSectionConfig[]
    if (sections.length === 0) return null

    const ids = new Set<string>()
    for (const section of sections) {
      const visibleToMain =
        section.attendee_categories == null ||
        section.attendee_categories.includes(primaryCategoryId)
      if (!visibleToMain) continue
      for (const pid of section.product_ids ?? []) ids.add(pid)
    }
    return ids
  })()

  const mainTickets = mainProductIds
    ? products.filter(
        (p) =>
          p.category === TICKET_CATEGORY &&
          p.is_active !== false &&
          mainProductIds.has(p.id),
      )
    : []
  const minPrice =
    mainTickets.length > 0 ? Math.min(...mainTickets.map((p) => p.price)) : null
  const sectionHeadingId = sectionTitle
    ? `passes-flow-${salesFlowId ?? "other"}`
    : undefined

  return (
    <section
      aria-labelledby={sectionHeadingId}
      className={`space-y-6 ${inlineCta ? "" : "pb-24 lg:pb-0"}`}
    >
      {sectionTitle && (
        <h2
          id={sectionHeadingId}
          className="text-lg font-semibold text-pass-title"
        >
          {sectionTitle}
        </h2>
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
              onSwitchToBuy={readOnly ? undefined : flowPurchase}
              products={products}
              readOnly={readOnly}
              salesFlowId={salesFlowId}
            />
          ))
        )}
      </div>

      {/* Desktop CTA Card */}
      {!readOnly && flowPurchase && (
        <div className={inlineCta ? "mt-4" : "hidden lg:block mt-6"}>
          {!hasPurchasedPasses && !inlineCta ? (
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
                      onClick={() => flowPurchase()}
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
                    {t(
                      hasPurchasedPasses
                        ? "passes.need_more_passes"
                        : "passes.adventure_awaits",
                    )}
                  </p>
                </div>
                <Button
                  onClick={() => flowPurchase()}
                  className="flex items-center gap-2 bg-foreground hover:bg-foreground text-background px-5 py-2.5 rounded-lg text-sm font-semibold transition-all whitespace-nowrap active:scale-95"
                >
                  {t(
                    hasPurchasedPasses
                      ? "passes.buy_passes"
                      : "passes.get_your_pass",
                  )}
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Mobile Sticky Footer — same fixed-dark treatment as the desktop
          hero above: the footer stays dark regardless of theme, so its
          text and the pill button use literal white/neutral. */}
      {!readOnly && flowPurchase && !inlineCta && (
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
                  onClick={() => flowPurchase()}
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
                </div>
                <Button
                  onClick={() => flowPurchase()}
                  className="flex items-center justify-center gap-1.5 bg-foreground hover:bg-foreground text-background px-5 py-2.5 rounded-xl text-sm font-bold transition-all shadow-lg whitespace-nowrap active:scale-95"
                >
                  {t("passes.buy")}
                  <ArrowRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
export default YourPasses
