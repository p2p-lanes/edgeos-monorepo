export const MIN_PANEL_WIDTH = 360
export const MAX_PANEL_WIDTH = 680
export const DEFAULT_PANEL_WIDTH = 480

// Keep enough of the application visible for forms, cards, and navigation to
// remain usable while the desktop assistant is docked beside it.
export const MIN_APPLICATION_WIDTH = 560

type PanelWidthContext = {
  viewportWidth: number
  applicationLeft: number
}

export function storedAssistantPanelWidth(value: string | null): number {
  if (value === null) return DEFAULT_PANEL_WIDTH

  const width = Number(value)
  return Number.isFinite(width)
    ? Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, width))
    : DEFAULT_PANEL_WIDTH
}

export function maximumAssistantPanelWidth({
  viewportWidth,
  applicationLeft,
}: PanelWidthContext): number {
  const availableWidth =
    viewportWidth - Math.max(0, applicationLeft) - MIN_APPLICATION_WIDTH

  return Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, availableWidth))
}

export function clampAssistantPanelWidth(
  requestedWidth: number,
  context: PanelWidthContext,
): number {
  const width = Number.isFinite(requestedWidth)
    ? requestedWidth
    : DEFAULT_PANEL_WIDTH

  return Math.min(
    maximumAssistantPanelWidth(context),
    Math.max(MIN_PANEL_WIDTH, width),
  )
}
