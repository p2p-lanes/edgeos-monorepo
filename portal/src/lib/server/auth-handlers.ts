import "server-only"
import {
  backendFetch,
  errorResponse,
  PortalHttpError,
  privateJson,
  readBody,
} from "./backend"
import { ingressHeaders } from "./ingress"
import {
  deleteSessionCookie,
  readSession,
  sessionToken,
  setSessionCookie,
  validateSession,
} from "./session"
import { requireSameOrigin, resolveRequestTenant } from "./tenant"

async function authBody(request: Request): Promise<Record<string, unknown>> {
  if (
    request.headers.get("content-type")?.split(";")[0] !== "application/json"
  ) {
    throw new PortalHttpError(415, "json_required")
  }
  try {
    const body = JSON.parse(
      new TextDecoder().decode(await readBody(request, 16_384)),
    )
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new Error()
    return body
  } catch (error) {
    if (error instanceof PortalHttpError) throw error
    throw new PortalHttpError(400, "invalid_request")
  }
}

export async function handleAuthPost(
  request: Request,
  action: "login" | "verify" | "migrate" | "logout",
): Promise<Response> {
  try {
    requireSameOrigin(request)
    if (action === "logout") {
      // No backend revocation API exists. The consumer must clear its query cache
      // and refresh navigation; Route Handlers cannot clear the browser Router Cache.
      return deleteSessionCookie(privateJson({ session: null }), request)
    }
    const body = await authBody(request)
    const tenant = await resolveRequestTenant(request.headers)
    let token: string
    if (action === "migrate") {
      if (typeof body.access_token !== "string")
        throw new PortalHttpError(400, "invalid_request")
      token = body.access_token
    } else {
      if (
        typeof body.email !== "string" ||
        (action === "verify" && typeof body.code !== "string")
      ) {
        throw new PortalHttpError(400, "invalid_request")
      }
      const upstream = await backendFetch(
        `/api/v1/auth/human/${action === "login" ? "login" : "authenticate"}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...ingressHeaders(request.headers),
          },
          body: JSON.stringify({
            email: body.email,
            tenant_id: tenant.id,
            ...(action === "verify" ? { code: body.code } : {}),
          }),
        },
      )
      if (!upstream.ok)
        throw new PortalHttpError(
          upstream.status,
          "auth_rejected",
          upstream.headers.get("retry-after"),
        )
      const data = await upstream.json()
      if (action === "login") {
        return privateJson({
          email: data.email,
          expires_in_minutes: data.expires_in_minutes,
        })
      }
      if (typeof data.access_token !== "string")
        throw new PortalHttpError(502, "invalid_auth_response")
      token = data.access_token
    }
    const session = await validateSession(token, tenant)
    if (action === "migrate" && sessionToken(request)) {
      let existing = null
      try {
        existing = await readSession(request, tenant)
      } catch (error) {
        // A definitive rejection permits replacing an expired cookie. A temporary
        // outage does not permit overwriting a possibly valid different identity.
        if (
          !(error instanceof PortalHttpError) ||
          error.code !== "session_invalid"
        )
          throw error
      }
      if (existing && existing.human.id !== session.human.id)
        throw new PortalHttpError(409, "session_conflict")
      // Preserve an already-valid cookie, including its original expiration.
      if (existing) return privateJson({ session: existing })
    }
    return setSessionCookie(privateJson({ session }), request, token, session)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function handleSessionGet(request: Request): Promise<Response> {
  try {
    const tenant = await resolveRequestTenant(request.headers)
    return privateJson({ session: await readSession(request, tenant) })
  } catch (error) {
    return errorResponse(error)
  }
}
