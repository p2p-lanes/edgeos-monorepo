import {
  type AnalyticsBus,
  type CheckoutClient,
  type CheckoutRuntimeResponse,
  type CheckoutStore,
  createCheckoutClient,
  createCheckoutStore,
  type Transport,
} from "@edgeos/checkout-core"
import { type ReactNode, useEffect, useRef } from "react"
import { CheckoutStoreContext } from "./context"

export interface CheckoutProviderProps {
  children: ReactNode
  /** Provide a pre-built store; the provider then owns neither its creation nor disposal. */
  store?: CheckoutStore
  /** Or a pre-built client. */
  client?: CheckoutClient
  /** Or build a client from these (slug required unless `store`/`client` given). */
  slug?: string
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

  // Build the store exactly once. When `store` is supplied we adopt it.
  const ownedRef = useRef(false)
  const storeRef = useRef<CheckoutStore | null>(null)
  if (storeRef.current === null) {
    if (props.store) {
      storeRef.current = props.store
      ownedRef.current = false
    } else {
      storeRef.current = buildStore(props)
      ownedRef.current = true
    }
  }
  const store = storeRef.current

  useEffect(() => {
    if (autoLoad) void store.load()
    return () => {
      if (ownedRef.current) store.dispose()
    }
    // Mount-once: the store identity is stable for the provider's lifetime, so
    // an empty dependency array is intentional (load on mount, dispose on unmount).
  }, [])

  return (
    <CheckoutStoreContext.Provider value={store}>
      {children}
    </CheckoutStoreContext.Provider>
  )
}
