"use client"

import Cookies from "js-cookie"
import { ensureSafeServiceWorker } from "./service-worker"
import {
  hasVerifiedSession,
  type PortalSession,
  type SessionSnapshot,
  sessionIdentity,
} from "./session-contract"
import { rotateSessionRequests } from "./session-network"

export function clearSessionDrafts(): void {
  for (let index = localStorage.length - 1; index >= 0; index--) {
    const key = localStorage.key(index)
    if (key?.startsWith("open-cart:")) localStorage.removeItem(key)
  }
  Cookies.remove("user_form_data_checkout_edge", { path: "/" })
}

export class SessionRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    public retryable = false,
  ) {
    super(code)
  }
}

export async function authRequest(
  action: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<{ session: PortalSession | null }> {
  await ensureSafeServiceWorker()
  let response: Response
  try {
    response = await fetch(`/api/auth/${action}`, {
      method: action === "session" ? "GET" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      headers:
        body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
    })
  } catch {
    throw new SessionRequestError(503, "session_unavailable", true)
  }
  const data = await response.json().catch(() => null)
  if (!response.ok)
    throw new SessionRequestError(
      response.status,
      data?.code ?? "session_unavailable",
      response.status === 429 || response.status >= 500,
    )
  if (
    action !== "login" &&
    (!data ||
      typeof data !== "object" ||
      !("session" in data) ||
      (data.session !== null &&
        (typeof data.session?.human?.id !== "string" ||
          typeof data.session?.human?.tenant_id !== "string" ||
          !Number.isFinite(Date.parse(data.session?.expires_at)))))
  )
    throw new SessionRequestError(502, "session_unavailable", true)
  return data
}

async function readCurrentSession(onRejected: () => void): Promise<{
  session: PortalSession | null
}> {
  try {
    return await authRequest("session")
  } catch (error) {
    if (
      !(error instanceof SessionRequestError) ||
      error.code !== "session_invalid"
    )
      throw error
    onRejected()
    clearSessionDrafts()
    await authRequest("logout")
    return { session: null }
  }
}

/** Owns browser session metadata only. Legacy bearer storage is read exclusively
 * for a server-validated import and is never copied into this state or events.
 */
export class SessionLifecycle {
  private snapshot: SessionSnapshot
  private listeners = new Set<() => void>()
  private revision = 0
  private pending: Promise<void> | null = null
  private logoutInProgress = false
  private verificationController: AbortController | null = null
  retry = () => this.revalidate()
  constructor(
    initial: SessionSnapshot,
    private navigate: (destination?: string) => void,
    private changed: () => void,
  ) {
    this.snapshot = initial
  }
  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish(snapshot: SessionSnapshot) {
    this.snapshot = snapshot
    for (const listener of this.listeners) listener()
  }
  private commit(destination?: string, broadcast = false) {
    this.revision++
    rotateSessionRequests(true)
    localStorage.removeItem("token")
    this.publish({ status: "changing", session: null })
    // Observers must not rebroadcast: two tabs would otherwise reload each
    // other indefinitely after the original account change.
    if (broadcast) this.changed()
    // A document navigation replaces both Router Cache and identity-owned React
    // state. It also prevents stale RSC hydration from repopulating a new cache.
    this.navigate(destination)
  }
  revalidate = (migrate = false): Promise<void> => {
    if (this.logoutInProgress) return Promise.resolve()
    if (this.pending)
      return this.pending.then(() => {
        if (this.snapshot.status === "changing") return this.revalidate(migrate)
      })
    const revision = this.revision
    let readOnly = true
    const onRejected = () => {
      readOnly = false
      if (revision !== this.revision) return
      rotateSessionRequests(true)
      this.publish({ status: "changing", session: null })
    }
    this.pending = (async () => {
      this.retry = () => this.revalidate()
      try {
        const legacy = migrate ? localStorage.getItem("token") : null
        readOnly = !legacy
        if (migrate && !legacy && hasVerifiedSession(this.snapshot)) return
        let result: { session: PortalSession | null }
        try {
          result = legacy
            ? await authRequest("migrate", { access_token: legacy })
            : await readCurrentSession(onRejected)
        } catch (error) {
          if (
            error instanceof SessionRequestError &&
            error.code === "session_invalid"
          ) {
            clearSessionDrafts()
            if (legacy) localStorage.removeItem("token")
            // Rejecting an imported credential says nothing about a different
            // valid cookie already in this browser. Verify that cookie separately.
            result = await readCurrentSession(onRejected)
          } else throw error
        }
        if (revision !== this.revision) return
        if (legacy) localStorage.removeItem("token")
        if (
          this.snapshot.status === "changing" ||
          sessionIdentity(result.session) !==
            sessionIdentity(this.snapshot.session)
        ) {
          this.commit(undefined, Boolean(legacy))
        } else {
          if (this.snapshot.status === "unavailable") rotateSessionRequests()
          this.publish({
            status: result.session ? "authenticated" : "anonymous",
            session: result.session,
          })
        }
      } catch (error) {
        if (revision !== this.revision) return
        this.retry = () => this.revalidate(migrate)
        // A failed read is not a revocation. Retain only a still-current,
        // unexpired verified identity, never a retired or mutation-uncertain one.
        // Definitive rejection retires it before attempting cookie cleanup.
        if (
          readOnly &&
          hasVerifiedSession(this.snapshot) &&
          (!(error instanceof SessionRequestError) || error.retryable)
        )
          return
        this.publish({
          status:
            error instanceof SessionRequestError && error.status === 409
              ? "conflict"
              : "unavailable",
          session: null,
        })
      }
    })().finally(() => {
      this.pending = null
    })
    return this.pending
  }
  async verify(
    email: string,
    code: string,
    destination?: string,
  ): Promise<PortalSession> {
    await this.pending
    if (this.snapshot.status === "changing")
      throw new SessionRequestError(409, "session_changing")
    if (this.verificationController)
      throw new SessionRequestError(409, "session_changing")
    this.revision++
    const revision = this.revision
    const controller = new AbortController()
    this.verificationController = controller
    rotateSessionRequests(true)
    try {
      const { session } = await authRequest(
        "verify",
        { email, code },
        controller.signal,
      )
      if (revision !== this.revision)
        throw new SessionRequestError(409, "session_changing")
      if (!session)
        throw new SessionRequestError(502, "session_unavailable", true)
      if (
        this.snapshot.session &&
        sessionIdentity(session) !== sessionIdentity(this.snapshot.session)
      )
        clearSessionDrafts()
      this.commit(destination, true)
      return session
    } catch (error) {
      if (revision !== this.revision) throw error
      rotateSessionRequests()
      // An interrupted response may already have set a cookie. Do not resume
      // old-identity resource requests until the current cookie is verified.
      if (!(error instanceof SessionRequestError) || error.status >= 500) {
        rotateSessionRequests(true)
        this.publish({ status: "unavailable", session: null })
        this.retry = () => this.revalidate()
        this.changed()
      }
      throw error
    } finally {
      if (this.verificationController === controller)
        this.verificationController = null
    }
  }
  async logout(destination?: string): Promise<void> {
    if (this.logoutInProgress) return
    this.logoutInProgress = true
    this.verificationController?.abort()
    const pendingRead = this.pending
    this.revision++
    rotateSessionRequests(true)
    clearSessionDrafts()
    this.publish({ status: "changing", session: null })
    try {
      await pendingRead
      await authRequest("logout")
      this.commit(destination, true)
    } catch {
      rotateSessionRequests()
      this.retry = () => this.logout(destination)
      this.publish({ status: "unavailable", session: null })
    } finally {
      this.logoutInProgress = false
    }
  }
  retireView = () => {
    this.verificationController?.abort()
    this.revision++
    rotateSessionRequests(true)
    this.publish({ status: "changing", session: null })
  }
  discardLegacy = async () => {
    clearSessionDrafts()
    localStorage.removeItem("token")
    await this.revalidate()
  }
}
