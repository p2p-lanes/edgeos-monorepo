import { PreviewEventCard } from "../parts/PreviewEventCard"
import { PreviewHeaderBar } from "../parts/PreviewHeaderBar"
import { PreviewSidebar } from "../parts/PreviewSidebar"

// Full portal Home layout: sidebar (PopupsMenu + ResourcesMenu + FooterMenu)
// on the left, header bar + event card on the right.
export function HomeView() {
  return (
    <div
      className="flex h-full"
      style={{ backgroundColor: "var(--background)" }}
    >
      <PreviewSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <PreviewHeaderBar />
        <main
          className="flex-1 overflow-y-auto px-6 py-6"
          style={{ backgroundColor: "var(--background)" }}
        >
          <div className="mx-auto max-w-3xl">
            <PreviewEventCard />
          </div>
        </main>
      </div>
    </div>
  )
}
