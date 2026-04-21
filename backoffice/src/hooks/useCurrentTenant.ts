import { useQuery } from "@tanstack/react-query"
import { TenantsService } from "@/client"
import { useWorkspace } from "@/contexts/WorkspaceContext"

export function useCurrentTenant() {
  const { effectiveTenantId } = useWorkspace()
  return useQuery({
    queryKey: ["tenants", effectiveTenantId],
    queryFn: () => TenantsService.getTenant({ tenantId: effectiveTenantId! }),
    enabled: !!effectiveTenantId,
    staleTime: 5 * 60 * 1000,
  })
}
