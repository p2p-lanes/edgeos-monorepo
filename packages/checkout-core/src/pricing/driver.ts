// The money authority. The core NEVER computes the payable total itself — it
// debounces changes and asks the server (POST /checkout/{slug}/preview) for an
// authoritative breakdown, then stores it. Rapid changes collapse into one call
// (debounce); racing responses resolve last-write-wins so a slow earlier reply
// can never overwrite a newer one.

import type { CheckoutClient } from "../client"
import type { CheckoutApiError } from "../transport/errors"
import type {
  CheckoutPreviewRequest,
  CheckoutPreviewResponse,
  ProductLine,
} from "../types/api"

export interface PricingInput {
  products: ProductLine[]
  couponCode?: string | null
  insurance?: boolean
}

export type PricingStatus = "idle" | "loading" | "success" | "error"

export interface PricingState {
  status: PricingStatus
  /** The authoritative server breakdown, or null when nothing is priced yet. */
  preview: CheckoutPreviewResponse | null
  error: CheckoutApiError | Error | null
}

export interface PricingDriverOptions {
  client: Pick<CheckoutClient, "preview">
  /** Debounce window in ms (default 300). */
  debounceMs?: number
}

export interface PricingDriver {
  /** Schedule a debounced preview for the given selection inputs. */
  update(input: PricingInput): void
  getState(): PricingState
  subscribe(listener: (state: PricingState) => void): () => void
  /** Fire any pending preview immediately and await it (e.g. before submit). */
  flush(): Promise<void>
  /** Cancel pending work and drop listeners. */
  dispose(): void
}

const IDLE: PricingState = { status: "idle", preview: null, error: null }

export function createPricingDriver(opts: PricingDriverOptions): PricingDriver {
  const debounceMs = opts.debounceMs ?? 300
  let state: PricingState = IDLE
  const listeners = new Set<(state: PricingState) => void>()

  let timer: ReturnType<typeof setTimeout> | null = null
  let pendingInput: PricingInput | null = null
  // Monotonic id of the most recently FIRED request; a resolving response that
  // isn't the latest is ignored (last-write-wins).
  let fireSeq = 0
  let inflight: Promise<void> | null = null

  function setState(next: PricingState) {
    state = next
    for (const l of listeners) l(state)
  }

  function toRequest(input: PricingInput): CheckoutPreviewRequest {
    return {
      products: input.products,
      coupon_code: input.couponCode ?? null,
      insurance: input.insurance ?? false,
    }
  }

  function fire(input: PricingInput): Promise<void> {
    const seq = ++fireSeq
    setState({ status: "loading", preview: state.preview, error: null })
    const p = opts.client
      .preview(toRequest(input))
      .then((preview) => {
        if (seq !== fireSeq) return // superseded — drop stale response
        setState({ status: "success", preview, error: null })
      })
      .catch((error: CheckoutApiError | Error) => {
        if (seq !== fireSeq) return
        setState({ status: "error", preview: state.preview, error })
      })
      .finally(() => {
        if (seq === fireSeq) inflight = null
      })
    inflight = p
    return p
  }

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  return {
    update(input) {
      clearTimer()
      // Nothing to price — the /preview endpoint requires >= 1 line. Reset to a
      // clean idle state instead of calling with an empty cart.
      if (input.products.length === 0) {
        pendingInput = null
        fireSeq++ // invalidate any in-flight response
        setState(IDLE)
        return
      }
      pendingInput = input
      timer = setTimeout(() => {
        timer = null
        const next = pendingInput
        pendingInput = null
        if (next) fire(next)
      }, debounceMs)
    },
    getState() {
      return state
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async flush() {
      clearTimer()
      if (pendingInput) {
        const next = pendingInput
        pendingInput = null
        await fire(next)
        return
      }
      if (inflight) await inflight
    },
    dispose() {
      clearTimer()
      listeners.clear()
      pendingInput = null
    },
  }
}
