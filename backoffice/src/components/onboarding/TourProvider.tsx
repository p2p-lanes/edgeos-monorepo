// ──────────────────────────────────────────────────────────────────────────
// TourProvider — sequencing for the product tour.
//
// Owns the step cursor, drives route navigation, presses whatever a step
// needs pressed before it can be measured, and remembers that the user is
// done with it. The pixels live in TourOverlay.
//
// Completion is stored in localStorage, mirroring the two markers that
// already exist (`trial_onboarding_dismissed_${tenantId}` in TrialOnboarding
// and `dashboard_seen_${userId}` on the dashboard). There is no per-user
// preferences column on the users table to put it in.
// ──────────────────────────────────────────────────────────────────────────

import { useNavigate } from "@tanstack/react-router"
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"

import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import { buildTourSteps } from "./tourSteps"
import type { TourContextValue } from "./types"
import { tourAnchorSelector } from "./useTourAnchor"

/**
 * Per-user, per-browser marker that the tour has been seen — finished or
 * skipped, both count. Scoped by user id rather than tenant: the tour teaches
 * product concepts, which do not change when a superadmin switches workspace.
 */
export const tourCompletedKey = (userId: string) =>
  `backoffice_tour_completed_${userId}`

/** How long to keep trying to press a `clickBefore` target. */
const CLICK_TIMEOUT_MS = 2_000

const TourContext = createContext<TourContextValue | null>(null)

export function TourProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const { selectedPopupId, isContextReady } = useWorkspace()
  const navigate = useNavigate()

  const [isActive, setIsActive] = useState(false)
  const [index, setIndex] = useState(0)

  // Steps that need a gathering are dropped when there isn't one yet, so a
  // brand-new workspace still gets a coherent tour.
  const steps = useMemo(
    () => buildTourSteps({ popupId: selectedPopupId }),
    [selectedPopupId],
  )

  const step = steps[index]
  const isFirst = index === 0
  const isLast = index === steps.length - 1

  const markCompleted = useCallback(() => {
    if (!user?.id) return
    localStorage.setItem(tourCompletedKey(user.id), "1")
  }, [user?.id])

  const start = useCallback(() => {
    setIndex(0)
    setIsActive(true)
  }, [])

  const finish = useCallback(() => {
    setIsActive(false)
    setIndex(0)
    markCompleted()
  }, [markCompleted])

  // Reads `index` rather than using the updater form: finishing is a side
  // effect, and React invokes state updaters twice in development.
  const next = useCallback(() => {
    if (index >= steps.length - 1) {
      finish()
      return
    }
    setIndex(index + 1)
  }, [index, steps.length, finish])

  const back = useCallback(() => {
    setIndex((i) => Math.max(0, i - 1))
  }, [])

  // "Skip" means skip the whole thing, not just this step.
  const skip = useCallback(() => {
    finish()
  }, [finish])

  // ── Auto-start on first login ───────────────────────────────────────────
  // Wait for the workspace context so `selectedPopupId` is settled before the
  // step list is built — otherwise the gathering steps get filtered out of a
  // workspace that does in fact have a gathering.
  const didAutoStart = useRef(false)
  useEffect(() => {
    if (didAutoStart.current) return
    if (!user?.id || !isContextReady) return
    if (localStorage.getItem(tourCompletedKey(user.id))) {
      didAutoStart.current = true
      return
    }
    didAutoStart.current = true
    start()
  }, [user?.id, isContextReady, start])

  // ── Navigate to where the step wants to be ──────────────────────────────
  useEffect(() => {
    if (!isActive || !step?.route) return
    navigate({ to: step.route.to, params: step.route.params })
  }, [isActive, step?.route, navigate])

  // ── Press whatever has to be pressed first ──────────────────────────────
  // Retried per frame: after a route change the target may not have mounted
  // yet. Presses once and stops.
  const clickBefore = step?.clickBefore
  useEffect(() => {
    if (!isActive || !clickBefore) return

    let frame = 0
    const deadline = Date.now() + CLICK_TIMEOUT_MS

    const tick = () => {
      const el = document.querySelector(tourAnchorSelector(clickBefore))
      if (el instanceof HTMLElement) {
        el.click()
        return
      }
      if (Date.now() > deadline) {
        if (import.meta.env.DEV) {
          console.warn(`[tour] clickBefore target "${clickBefore}" not found`)
        }
        return
      }
      frame = requestAnimationFrame(tick)
    }

    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [isActive, clickBefore])

  // ── Escape closes the tour, same as Skip ────────────────────────────────
  useEffect(() => {
    if (!isActive) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") skip()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isActive, skip])

  const value = useMemo<TourContextValue>(
    () => ({
      isActive,
      index,
      steps,
      step,
      isFirst,
      isLast,
      start,
      next,
      back,
      skip,
    }),
    [isActive, index, steps, step, isFirst, isLast, start, next, back, skip],
  )

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>
}

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext)
  if (!ctx) {
    throw new Error("useTour must be used within a TourProvider")
  }
  return ctx
}

/**
 * Non-throwing variant for components that render both inside and outside the
 * authenticated layout.
 */
export function useOptionalTour(): TourContextValue | null {
  return useContext(TourContext)
}
