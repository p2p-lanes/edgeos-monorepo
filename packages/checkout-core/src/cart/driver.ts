// Backend cart persistence for open checkout. Debounced upsert to
// PUT /checkout/{slug}/{flowSlug}/cart so the server can drive abandoned-cart recovery
// email, plus restore from a signed link (cid/sig). Tracks the cart meta
// (cartId + restoreToken) that becomes the purchase continuity proof used to
// supersede a prior PENDING payment.
//
// NO localStorage here — same-browser persistence is a host concern (the React
// adapter / host app can layer it on). This module owns only the backend cart.

import type { CheckoutClient } from "../client"
import type { SelectionState } from "../selection/state"
import type { CartState } from "../types/api"
import {
  cartStateToSelection,
  selectionToCartState,
  type ToCartOptions,
} from "./mapping"

export interface CartMeta {
  cartId: string | null
  /** HMAC restore token; non-null only when the popup has a signing secret. */
  restoreToken: string | null
}

export interface CartDriverOptions {
  client: Pick<CheckoutClient, "upsertCart" | "restoreCart">
  /** Debounce window for save() in ms (default 800). */
  debounceMs?: number
}

export interface CartRestoreResult {
  selection: SelectionState
  meta: CartMeta
}

export interface CartDriver {
  /** Debounced backend upsert. No-op when the email is not yet valid. */
  save(email: string, selection: SelectionState, opts?: ToCartOptions): void
  /** Immediate upsert (e.g. before submit); resolves with the fresh meta. */
  flush(
    email: string,
    selection: SelectionState,
    opts?: ToCartOptions,
  ): Promise<CartMeta>
  /** Restore a cart from a signed link; hydrates a selection and sets meta. */
  restore(cid: string, sig: string): Promise<CartRestoreResult>
  getMeta(): CartMeta
  /** Reset meta and cancel pending work (e.g. after payment success). */
  clear(): void
  dispose(): void
}

function isEmailish(email: string): boolean {
  return email.includes("@")
}

const EMPTY_META: CartMeta = { cartId: null, restoreToken: null }

export function createCartDriver(opts: CartDriverOptions): CartDriver {
  const debounceMs = opts.debounceMs ?? 800
  let meta: CartMeta = { ...EMPTY_META }
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: { email: string; cart: CartState } | null = null
  // Serializes upserts so an out-of-order response can't clobber meta.
  let inflight: Promise<void> = Promise.resolve()
  let seq = 0

  function clearTimer() {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
  }

  async function doUpsert(email: string, cart: CartState): Promise<void> {
    if (!isEmailish(email)) return
    const mySeq = ++seq
    try {
      const res = await opts.client.upsertCart({ email, items: cart })
      if (mySeq === seq) {
        meta = { cartId: res.id, restoreToken: res.restore_token ?? null }
      }
    } catch {
      // Network failure — retain the prior meta; the host/localStorage (if any)
      // still holds the snapshot.
    }
  }

  function enqueueUpsert(email: string, cart: CartState): Promise<void> {
    const run = () => doUpsert(email, cart)
    inflight = inflight.then(run, run)
    return inflight
  }

  return {
    save(email, selection, toCartOpts) {
      pending = { email, cart: selectionToCartState(selection, toCartOpts) }
      clearTimer()
      timer = setTimeout(() => {
        timer = null
        const next = pending
        pending = null
        if (next) enqueueUpsert(next.email, next.cart)
      }, debounceMs)
    },
    async flush(email, selection, toCartOpts) {
      clearTimer()
      pending = null
      await enqueueUpsert(email, selectionToCartState(selection, toCartOpts))
      return meta
    },
    async restore(cid, sig) {
      const openCart = await opts.client.restoreCart(cid, sig)
      meta = {
        cartId: openCart.id,
        restoreToken: openCart.restore_token ?? sig,
      }
      return { selection: cartStateToSelection(openCart.items), meta }
    },
    getMeta() {
      return meta
    },
    clear() {
      clearTimer()
      pending = null
      seq++ // invalidate any in-flight response
      meta = { ...EMPTY_META }
    },
    dispose() {
      clearTimer()
      pending = null
    },
  }
}
