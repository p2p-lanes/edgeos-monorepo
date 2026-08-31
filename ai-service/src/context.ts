import { createHmac } from "node:crypto"
import type { UserRole } from "./types.js"

export type RequestIdentity = {
  authorization: string
  requestedTenantId?: string
  popupId?: string
  pathname?: string
}

export type PopupSummary = {
  id: string
  tenant_id: string
  name: string
}

export type EdgeOSContext = {
  authorization: string
  tenantId: string
  popup?: PopupSummary
  pathname?: string
  user: {
    id: string
    email: string
    name?: string | null
    role: UserRole
  }
}

type EdgeOSUser = {
  id: string
  email: string
  full_name?: string | null
  role: UserRole
  tenant_id?: string | null
}

export class EdgeOSApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = "EdgeOSApiError"
  }
}

const COPILOT_ROLES = new Set<UserRole>(["superadmin", "admin", "operator"])

export function assertCopilotAccess(role: UserRole) {
  if (!COPILOT_ROLES.has(role)) {
    throw new EdgeOSApiError(
      "Operator access is required to use the assistant",
      403,
    )
  }
}

export async function responseError(
  response: Response,
): Promise<EdgeOSApiError> {
  let message = `EdgeOS API returned ${response.status}`
  try {
    const body = (await response.json()) as { detail?: unknown }
    if (typeof body.detail === "string") message = body.detail
    else if (body.detail !== undefined) message = JSON.stringify(body.detail)
  } catch {
    // Keep the status-only error when the response is not JSON.
  }
  return new EdgeOSApiError(message, response.status)
}

export function approvalSecretForContext(
  secret: string,
  context: Pick<EdgeOSContext, "tenantId" | "popup" | "user">,
) {
  return createHmac("sha256", secret)
    .update(
      JSON.stringify({
        userId: context.user.id,
        tenantId: context.tenantId,
        activePopupId: context.popup?.id ?? null,
      }),
    )
    .digest()
}

export class EdgeOSContextResolver {
  constructor(private readonly baseUrl: string) {}

  private headers(authorization: string, tenantId?: string) {
    return {
      Authorization: authorization,
      ...(tenantId ? { "X-Tenant-Id": tenantId } : {}),
      Accept: "application/json",
    }
  }

  async resolve(identity: RequestIdentity): Promise<EdgeOSContext> {
    if (!identity.authorization.startsWith("Bearer ")) {
      throw new EdgeOSApiError("Authentication required", 401)
    }

    const meResponse = await fetch(`${this.baseUrl}/api/v1/users/me`, {
      headers: this.headers(identity.authorization),
    })
    if (!meResponse.ok) throw await responseError(meResponse)
    const user = (await meResponse.json()) as EdgeOSUser
    assertCopilotAccess(user.role)

    let tenantId = user.tenant_id ?? undefined
    if (user.role === "superadmin") {
      tenantId = identity.requestedTenantId
      if (!tenantId) {
        throw new EdgeOSApiError(
          "Select an organization before using the assistant",
          400,
        )
      }
    } else if (
      identity.requestedTenantId &&
      tenantId &&
      identity.requestedTenantId !== tenantId
    ) {
      throw new EdgeOSApiError("Invalid organization context", 403)
    }

    if (!tenantId) {
      throw new EdgeOSApiError("The user has no organization assigned", 403)
    }

    const context: EdgeOSContext = {
      authorization: identity.authorization,
      tenantId,
      pathname: identity.pathname,
      user: {
        id: user.id,
        email: user.email,
        name: user.full_name,
        role: user.role,
      },
    }

    if (identity.popupId) {
      const popupResponse = await fetch(
        `${this.baseUrl}/api/v1/popups/${encodeURIComponent(identity.popupId)}`,
        { headers: this.headers(identity.authorization, tenantId) },
      )
      if (!popupResponse.ok) throw await responseError(popupResponse)
      const popup = (await popupResponse.json()) as PopupSummary
      if (popup.tenant_id !== tenantId) {
        throw new EdgeOSApiError(
          "The selected gathering is outside the current organization",
          403,
        )
      }
      context.popup = popup
    }

    return context
  }
}
