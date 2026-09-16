import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"
import { ArrowUpRight } from "lucide-react"

import { BookingCalendar } from "@/components/accommodations/BookingCalendar"
import { BookingsTab } from "@/components/accommodations/BookingsTab"
import { PhotosTab } from "@/components/accommodations/PhotosTab"
import { PropertiesTab } from "@/components/accommodations/PropertiesTab"
import { RoomsTab } from "@/components/accommodations/RoomsTab"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useWorkspace } from "@/contexts/WorkspaceContext"

// Calendar first: the question an operator opens this section with is "is
// that room free", not "what rooms exist".
const TABS = ["calendar", "rooms", "properties", "bookings", "photos"] as const
type TabKey = (typeof TABS)[number]

interface AccommodationsSearch {
  tab?: TabKey
}

export const Route = createFileRoute("/_layout/accommodations/")({
  component: Accommodations,
  validateSearch: (raw: Record<string, unknown>): AccommodationsSearch =>
    TABS.includes(raw.tab as TabKey) ? { tab: raw.tab as TabKey } : {},
  head: () => ({
    meta: [{ title: "Accommodations - EdgeOS" }],
  }),
})

/**
 * Lodging inventory for a gathering.
 *
 * This section owns what *exists*: properties, room types, units, nightly
 * prices and photos. What the checkout *offers* is decided in the
 * Accommodation ticketing step, which reads this inventory, hence the link
 * in the header rather than a second set of controls here.
 */
function Accommodations() {
  const navigate = useNavigate()
  const { isContextReady, selectedPopupId } = useWorkspace()
  const { tab } = Route.useSearch()
  const activeTab: TabKey = tab ?? "calendar"

  return (
    <div className="flex flex-col gap-6">
      {!isContextReady && <WorkspaceAlert resource="accommodations" />}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Accommodations</h1>
          <p className="text-muted-foreground">
            Inventory for this gathering: rooms, units, nightly pricing and
            photos.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className="font-normal">
            Sold through the Accommodation step
          </Badge>
          <Link
            to="/ticketing-steps"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            Edit in Ticketing Steps
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {isContextReady && selectedPopupId && (
        <Tabs
          value={activeTab}
          onValueChange={(value) =>
            navigate({
              to: "/accommodations",
              search: { tab: value as TabKey },
              replace: true,
            })
          }
        >
          <TabsList>
            <TabsTrigger value="calendar">Calendar</TabsTrigger>
            <TabsTrigger value="rooms">Rooms</TabsTrigger>
            <TabsTrigger value="properties">Properties</TabsTrigger>
            <TabsTrigger value="bookings">Bookings</TabsTrigger>
            <TabsTrigger value="photos">Photos</TabsTrigger>
          </TabsList>

          <QueryErrorBoundary>
            <TabsContent value="calendar" className="mt-4">
              <BookingCalendar popupId={selectedPopupId} />
            </TabsContent>
            <TabsContent value="rooms" className="mt-4">
              <RoomsTab popupId={selectedPopupId} />
            </TabsContent>
            <TabsContent value="properties" className="mt-4">
              <PropertiesTab popupId={selectedPopupId} />
            </TabsContent>
            <TabsContent value="bookings" className="mt-4">
              <BookingsTab popupId={selectedPopupId} />
            </TabsContent>
            <TabsContent value="photos" className="mt-4">
              <PhotosTab popupId={selectedPopupId} />
            </TabsContent>
          </QueryErrorBoundary>
        </Tabs>
      )}
    </div>
  )
}
