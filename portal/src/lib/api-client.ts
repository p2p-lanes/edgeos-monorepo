import { OpenAPI } from "@/client"
import { resolveRequestLanguage } from "@/lib/language-storage"
import { notifyInvalidSession, sessionRequestSignal } from "./session-network"

OpenAPI.BASE = ""
OpenAPI.TOKEN = undefined

OpenAPI.interceptors.request.use(async (config) => {
  // Browser SDK configuration never supplies server credentials. SSR and public
  // metadata use the separate fixed-origin server transport.
  if (typeof window === "undefined") {
    throw new Error("Use request-local server transport during SSR")
  }
  config.signal = await sessionRequestSignal(
    config.signal as AbortSignal | undefined,
  )
  // Prefer the language the provider is currently showing (set synchronously
  // on switch), then the ?lang/?locale URL param, then the stored language.
  // The in-memory value wins because a mid-session switch updates the UI before
  // its ?lang navigation lands — reading the URL there would refetch dynamic
  // content in the previous language. It stays null until the provider mounts,
  // so the first render / a ?lang deep link still resolves via the URL param
  // (reading only localStorage raced the provider's write and dropped the
  // header on the first runtime request). The backend overlay is
  // default-agnostic, so an unsupported value simply returns the source.
  //
  // Shared with the language-dependent query keys via `resolveRequestLanguage`
  // so a cached response is always labelled with the language it was fetched in.
  const language = resolveRequestLanguage()
  if (language) {
    config.headers = { ...config.headers, "Accept-Language": language }
  }
  return config
})

OpenAPI.interceptors.response.use((response) => {
  notifyInvalidSession(
    response.status,
    response.headers["x-portal-response"] === "upstream",
    response.data?.code,
  )
  return response
})
