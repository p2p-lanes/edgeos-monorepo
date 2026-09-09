"use client"

import { usePathname } from "next/navigation"
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react"
import { flushSync } from "react-dom"
import { useTranslation } from "react-i18next"
import { Loader } from "@/components/ui/Loader"
import { getAuthRedirectPath, getSafeReturnTo } from "@/lib/safe-return-to"
import type { SessionSnapshot } from "@/lib/session-contract"
import { SessionLifecycle } from "@/lib/session-lifecycle"

const SessionContext = createContext<{
  snapshot: SessionSnapshot
  lifecycle: SessionLifecycle
} | null>(null)
const CHANNEL_KEY = "portal_session_changed"

export function SessionRecovery({
  conflict = false,
  onRetry,
  onDiscard,
  onSignIn,
}: {
  conflict?: boolean
  onRetry: () => void
  onDiscard?: () => void
  onSignIn?: () => void
}) {
  const { t } = useTranslation()
  return (
    <section
      role="alert"
      className="mx-auto flex min-h-64 max-w-lg flex-col items-center justify-center gap-4 p-6 text-center"
    >
      <p>{t(conflict ? "session.conflict" : "auth.network_error")}</p>
      <button
        type="button"
        className="rounded-md border px-4 py-2"
        onClick={conflict && onDiscard ? onDiscard : onRetry}
      >
        {t(conflict ? "session.continue_current" : "session.retry")}
      </button>
      {!conflict && onSignIn && (
        <button type="button" className="underline" onClick={onSignIn}>
          {t("auth.sign_up_or_log_in")}
        </button>
      )}
    </section>
  )
}

export function BootstrapRecovery() {
  return <SessionRecovery onRetry={() => window.location.reload()} />
}

export function SessionProvider({
  initial,
  children,
  onNavigate,
}: {
  initial: SessionSnapshot
  children: ReactNode
  onNavigate?: (destination?: string) => void
}) {
  const pathname = usePathname()
  const [lifecycle] = useState(
    () =>
      new SessionLifecycle(
        initial,
        onNavigate ??
          ((destination) =>
            window.location.assign(
              getSafeReturnTo(destination) ??
                `${window.location.pathname}${window.location.search}${window.location.hash}`,
            )),
        () => localStorage.setItem(CHANNEL_KEY, crypto.randomUUID()),
      ),
  )
  const snapshot = useSyncExternalStore(
    lifecycle.subscribe,
    lifecycle.getSnapshot,
    () => initial,
  )
  // An unavailable initial check must not replace public entry content. If a
  // personalized bootstrap has been retired, keep its old hydration tree closed
  // until verified again; the sign-in page itself never needs that private data.
  const retiredBootstrap =
    snapshot.status === "unavailable" &&
    initial.session !== null &&
    pathname !== "/auth"
  useEffect(() => {
    void lifecycle.revalidate(true)
    const refresh = () => {
      if (document.visibilityState === "visible") void lifecycle.retry()
    }
    const retireAndRefresh = () => {
      flushSync(lifecycle.retireView)
      void lifecycle.revalidate()
    }
    const storage = (event: StorageEvent) => {
      if (event.key === CHANNEL_KEY) retireAndRefresh()
    }
    const pagehide = () => {
      flushSync(lifecycle.retireView)
    }
    const pageshow = (event: PageTransitionEvent) => {
      if (event.persisted) retireAndRefresh()
    }
    window.addEventListener("storage", storage)
    window.addEventListener("focus", refresh)
    document.addEventListener("visibilitychange", refresh)
    window.addEventListener("pagehide", pagehide)
    window.addEventListener("pageshow", pageshow)
    window.addEventListener("portal:session-invalid", retireAndRefresh)
    return () => {
      window.removeEventListener("storage", storage)
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", refresh)
      window.removeEventListener("pagehide", pagehide)
      window.removeEventListener("pageshow", pageshow)
      window.removeEventListener("portal:session-invalid", retireAndRefresh)
    }
  }, [lifecycle])
  useEffect(() => {
    if (!snapshot.session) return
    const timer = setTimeout(
      () => {
        lifecycle.retireView()
        void lifecycle.revalidate()
      },
      Math.max(0, Date.parse(snapshot.session.expires_at) - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [snapshot.session, lifecycle])
  return (
    <SessionContext.Provider value={{ snapshot, lifecycle }}>
      {retiredBootstrap || snapshot.status === "conflict" ? (
        <SessionRecovery
          conflict={snapshot.status === "conflict"}
          onRetry={() => {
            void lifecycle.retry()
          }}
          onDiscard={() => {
            void lifecycle.discardLegacy()
          }}
          onSignIn={() => {
            const destination = getAuthRedirectPath(
              `${window.location.pathname}${window.location.search}${window.location.hash}`,
            )
            if (onNavigate) onNavigate(destination)
            else window.location.assign(destination)
          }}
        />
      ) : snapshot.status === "changing" ? (
        <Loader fullscreen />
      ) : (
        children
      )}
    </SessionContext.Provider>
  )
}

export function useSession() {
  const context = useContext(SessionContext)
  if (!context) throw new Error("useSession requires SessionProvider")
  return context
}
