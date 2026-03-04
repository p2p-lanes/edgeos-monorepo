import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { OpenAPI } from "@/client"

interface TranslationPublic {
  id: string
  tenant_id: string
  entity_type: string
  entity_id: string
  language: string
  data: Record<string, string>
  created_at: string | null
  updated_at: string | null
}

interface TranslationCreate {
  entity_type: string
  entity_id: string
  language: string
  data: Record<string, string>
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const token =
    typeof OpenAPI.TOKEN === "function"
      ? await OpenAPI.TOKEN({} as any)
      : OpenAPI.TOKEN
  const tenantId = localStorage.getItem("workspace_tenant_id")

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(tenantId ? { "X-Tenant-Id": tenantId } : {}),
  }

  const res = await fetch(`${OpenAPI.BASE}/api/v1${path}`, {
    ...options,
    headers: { ...headers, ...(options?.headers as Record<string, string>) },
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `API error: ${res.status}`)
  }

  if (res.status === 204) return undefined as T
  return res.json()
}

export function useTranslationsQuery(entityType: string, entityId: string) {
  return useQuery<TranslationPublic[]>({
    queryKey: ["translations", entityType, entityId],
    queryFn: () =>
      apiFetch(`/translations?entity_type=${entityType}&entity_id=${entityId}`),
    enabled: !!entityId,
  })
}

export function useUpsertTranslation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (data: TranslationCreate) =>
      apiFetch<TranslationPublic>("/translations", {
        method: "POST",
        body: JSON.stringify(data),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: ["translations", variables.entity_type, variables.entity_id],
      })
    },
  })
}

export function useDeleteTranslation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (id: string) =>
      apiFetch(`/translations/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["translations"] })
    },
  })
}

export interface AITranslateRequest {
  entity_type: string
  entity_id: string
  target_language: string
}

export function useAITranslate() {
  return useMutation({
    mutationFn: (data: AITranslateRequest) =>
      apiFetch<Record<string, string>>("/translations/ai-translate", {
        method: "POST",
        body: JSON.stringify(data),
      }),
  })
}

export type { TranslationPublic, TranslationCreate }
