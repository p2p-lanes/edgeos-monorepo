import {
  ApiKeysService as GeneratedApiKeysService,
  type ApiKeyCreate,
  type ApiKeyCreated,
  type ApiKeyPublic,
} from "@/client"

export type ApiKeyScope = "events:read" | "events:write" | "rsvp:write"
export type ApiKeyCreateBody = ApiKeyCreate
export type { ApiKeyCreated, ApiKeyPublic }

export const ApiKeysService = {
  list(): Promise<ApiKeyPublic[]> {
    return GeneratedApiKeysService.listApiKeys() as Promise<ApiKeyPublic[]>
  },

  create(body: ApiKeyCreateBody): Promise<ApiKeyCreated> {
    return GeneratedApiKeysService.createApiKey({
      requestBody: body,
    }) as Promise<ApiKeyCreated>
  },

  revoke(keyId: string): Promise<void> {
    return GeneratedApiKeysService.revokeApiKey({ keyId }) as Promise<void>
  },
}
