import { OpenAPI } from "@/client"
import { request as __request } from "@/client/core/request"

// Types kept in this file (instead of @/client) so the next OpenAPI client
// regeneration doesn't fight with hand-written code. Once `pnpm generate-client`
// picks up the new endpoints, swap callers to the autogen `ApiKeysService`.
export interface ApiKeyPublic {
  id: string
  name: string
  prefix: string
  created_at: string
  last_used_at: string | null
  expires_at: string | null
  revoked_at: string | null
}

export interface ApiKeyCreated extends ApiKeyPublic {
  key: string
}

export interface ApiKeyCreateBody {
  name: string
  expires_at?: string | null
}

export const ApiKeysService = {
  list(): Promise<ApiKeyPublic[]> {
    return __request(OpenAPI, {
      method: "GET",
      url: "/api/v1/api-keys",
    }) as unknown as Promise<ApiKeyPublic[]>
  },

  create(body: ApiKeyCreateBody): Promise<ApiKeyCreated> {
    return __request(OpenAPI, {
      method: "POST",
      url: "/api/v1/api-keys",
      body,
      mediaType: "application/json",
      errors: { 422: "Validation Error" },
    }) as unknown as Promise<ApiKeyCreated>
  },

  revoke(keyId: string): Promise<void> {
    return __request(OpenAPI, {
      method: "DELETE",
      url: "/api/v1/api-keys/{key_id}",
      path: { key_id: keyId },
    }) as unknown as Promise<void>
  },
}
