// ──────────────────────────────────────────────────────────────────────────
// Types for the product tour — a spotlight walkthrough that runs once on a
// user's first login and can be replayed from the Onboarding section.
//
// Steps are declarative: they describe where to be (`route`), what to press
// first (`clickBefore`) and what to highlight (`anchor`). The provider owns
// the sequencing; the overlay owns the pixels.
// ──────────────────────────────────────────────────────────────────────────

/**
 * A `data-tour` value. Anchors are addressed by attribute rather than by ref
 * so step definitions stay decoupled from component internals and survive the
 * conditional rendering in the sidebar (role gates, trial-only items).
 */
export type TourAnchorId = string

export interface TourStepRoute {
  /** TanStack Router path, e.g. "/popups/$id/edit". */
  to: string
  params?: Record<string, string>
}

export interface TourStep {
  /** Stable id — used as the React key and in tests. */
  id: string
  title: string
  /** One or two short paragraphs. Plain text; no markup. */
  body: string
  /**
   * Element to spotlight. When omitted the step renders as a centered dialog
   * (used for the welcome and closing steps).
   */
  anchor?: TourAnchorId
  /** Navigate here before showing the step. */
  route?: TourStepRoute
  /**
   * Press this element before measuring the anchor. Used to switch the tabs
   * in PopupForm: its TabsContent panels are `forceMount`ed and hidden with
   * `data-[state=inactive]:hidden`, so anything inside an inactive tab
   * measures as a zero-sized rect until the tab is actually active.
   */
  clickBefore?: TourAnchorId
}

export interface TourState {
  /** True while the overlay is on screen. */
  isActive: boolean
  /** Index into the resolved step list. */
  index: number
  steps: TourStep[]
}

export interface TourContextValue extends TourState {
  step: TourStep | undefined
  isFirst: boolean
  isLast: boolean
  start: () => void
  next: () => void
  back: () => void
  /** Ends the tour and records it as done, so it never auto-starts again. */
  skip: () => void
}
