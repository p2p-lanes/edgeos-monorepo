// Manual client for the tenant-level publishable-key endpoints. These aren't in
// the generated client yet (regenerating it reformats ~170 unrelated files), so
// we hand-write the three calls on the same `__request(OpenAPI, …)` core the
// generated services use — Bearer auth + X-Tenant-Id are injected by the client
// interceptors automatically. When the client is next regenerated, this file
// can be dropped in favor of the generated PublishableKeysService.

import { OpenAPI } from "@/client/core/OpenAPI"
import { request as __request } from "@/client/core/request"

export interface PublishableKeyPublic {
  id: string
  popup_id: string | null
  name: string
  key_prefix: string
  allowed_origins: string[]
  created_at: string
  last_used_at: string | null
  revoked_at: string | null
}

/** Returned once at creation — carries the raw browser-safe token. */
export interface PublishableKeyCreated extends PublishableKeyPublic {
  key: string
}

export interface PublishableKeyCreate {
  name: string
  allowed_origins: string[]
}

export const PublishableKeysService = {
  listPublishableKeys(): Promise<PublishableKeyPublic[]> {
    return __request(OpenAPI, {
      method: "GET",
      url: "/api/v1/publishable-keys",
      errors: { 422: "Validation Error" },
    })
  },

  createPublishableKey(data: {
    requestBody: PublishableKeyCreate
  }): Promise<PublishableKeyCreated> {
    return __request(OpenAPI, {
      method: "POST",
      url: "/api/v1/publishable-keys",
      body: data.requestBody,
      mediaType: "application/json",
      errors: { 422: "Validation Error" },
    })
  },

  revokePublishableKey(data: { keyId: string }): Promise<void> {
    return __request(OpenAPI, {
      method: "DELETE",
      url: "/api/v1/publishable-keys/{key_id}",
      path: { key_id: data.keyId },
      errors: { 422: "Validation Error" },
    })
  },
}
