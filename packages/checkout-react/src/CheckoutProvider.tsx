import {
  type AnalyticsBus,
  type CheckoutClient,
  type CheckoutRuntimeResponse,
  type CheckoutStore,
  createCheckoutClient,
  createCheckoutStore,
  type Transport,
} from "@edgeos/checkout-core"
import { type ReactNode, useEffect, useReducer, useRef } from "react"
import { CheckoutStoreContext } from "./context"

export interface CheckoutProviderProps {
  children: ReactNode
  /** Provide a pre-built store; the provider then owns neither its creation nor disposal. */
  store?: CheckoutStore
  /** Or a pre-built client. */
  client?: CheckoutClient
  /** Or build a client from these (slug required unless `store`/`client` given). */
  slug?: string
  /** Canonical sales flow for every checkout request. */
  flowSlug: string
  baseUrl?: string
  publishableKey?: string
  transport?: Transport
  /** Seed runtime to avoid a double fetch (SSR / already-bootstrapped page). */
  initialRuntime?: CheckoutRuntimeResponse
  analytics?: AnalyticsBus
  /** Call store.load() on mount (default true). */
  autoLoad?: boolean
}

function buildStore(props: CheckoutProviderProps): CheckoutStore {
  const client =
    props.client ??
    createCheckoutClient(
      {
        slug: props.slug ?? "",
        flowSlug: props.flowSlug,
        baseUrl: props.baseUrl,
        publishableKey: props.publishableKey,
      },
      props.transport,
    )
  return createCheckoutStore({
    client,
    runtime: props.initialRuntime,
    analytics: props.analytics,
  })
}

/**
 * Instantiates (or adopts) the checkout store and exposes it to the subtree.
 * A store built internally is disposed on unmount; an externally supplied
 * `store` is left untouched (the caller owns its lifecycle).
 */
export function CheckoutProvider(props: CheckoutProviderProps) {
  const { children, autoLoad = true } = props

  // Build the store lazily. When `store` is supplied we adopt it.
  const ownedRef = useRef(false)
  const storeRef = useRef<CheckoutStore | null>(null)
  const [, forceRerender] = useReducer((n: number) => n + 1, 0)
  if (storeRef.current === null) {
    if (props.store) {
      storeRef.current = props.store
      ownedRef.current = false
    } else {
      storeRef.current = buildStore(props)
      ownedRef.current = true
    }
  }

  useEffect(() => {
    // React StrictMode (and any real remount) runs cleanup→setup on the SAME
    // component instance, preserving refs. Our cleanup disposes an
    // internally-built store, tearing down its pricing/cart subscriptions — so
    // on the second setup `storeRef.current` points at a disposed store whose
    // async /preview responses would land on dead wiring (blank total, no cart).
    // Rebuild a fresh store before loading so the subtree always sees a live one.
    // StrictMode is the default in Vite/Next dev, so this must be handled here.
    if (ownedRef.current && storeRef.current?.isDisposed()) {
      storeRef.current = buildStore(props)
      forceRerender()
    }
    const store = storeRef.current
    if (!store) return
    if (autoLoad) void store.load()
    return () => {
      if (ownedRef.current) store.dispose()
    }
    // Mount-once: rebuild-if-disposed above handles the StrictMode remount, so an
    // empty dependency array is intentional (load on mount, dispose on unmount).
    // biome-ignore lint/correctness/useExhaustiveDependencies: mount-once by design
  }, [])

  return (
    <CheckoutStoreContext.Provider value={storeRef.current}>
      {children}
    </CheckoutStoreContext.Provider>
  )
}
