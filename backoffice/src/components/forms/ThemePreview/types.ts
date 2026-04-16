export type PreviewTab = "home" | "checkout"

export interface PreviewEvent {
  name: string
  tagline: string | null
  location: string | null
  start_date: string | null
  end_date: string | null
  express_checkout_background?: string | null
}

export interface ThemePreviewProps {
  colors: Record<string, string>
  fontBaseSize: string
  fontHeadingScale: string
  radius: string
  borderRadius: string
  highlightedKeys: Set<string>
  activeTab: PreviewTab
  onTabChange: (tab: PreviewTab) => void
  previewEvent: PreviewEvent
}

export interface ViewProps {
  highlightedKeys: Set<string>
  headingScale: number
}
