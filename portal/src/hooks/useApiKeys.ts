"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  type ApiKeyCreateBody,
  type ApiKeyCreated,
  type ApiKeyPublic,
  ApiKeysService,
} from "@/lib/apiKeysService"

const queryKey = ["api-keys"] as const

export function useApiKeys() {
  const queryClient = useQueryClient()

  const listQuery = useQuery<ApiKeyPublic[]>({
    queryKey,
    queryFn: () => ApiKeysService.list(),
  })

  const createMutation = useMutation<ApiKeyCreated, Error, ApiKeyCreateBody>({
    mutationFn: (body) => ApiKeysService.create(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  const revokeMutation = useMutation<void, Error, string>({
    mutationFn: (keyId) => ApiKeysService.revoke(keyId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })

  return {
    keys: listQuery.data ?? [],
    isLoading: listQuery.isLoading,
    error: listQuery.error,
    refresh: () => queryClient.invalidateQueries({ queryKey }),
    createKey: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    revokeKey: revokeMutation.mutateAsync,
    isRevoking: revokeMutation.isPending,
  }
}
