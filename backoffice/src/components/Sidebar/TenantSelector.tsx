import { useQuery } from "@tanstack/react-query"
import { useLocation, useNavigate } from "@tanstack/react-router"
import { Building2 } from "lucide-react"

import { TenantsService } from "@/client"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"

export function TenantSelector() {
  const { selectedTenantId, setSelectedTenantId } = useWorkspace()
  const location = useLocation()
  const navigate = useNavigate()

  const handleTenantChange = (value: string) => {
    setSelectedTenantId(value)
    if (/\/(new|edit)/.test(location.pathname)) {
      navigate({ to: "/" })
    }
  }

  const {
    data: tenants,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["tenants"],
    queryFn: () => TenantsService.listTenants({ skip: 0, limit: 100 }),
  })

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">Tenant</Label>
        <Skeleton className="h-9 w-full" />
      </div>
    )
  }

  if (!tenants?.results?.length) {
    return (
      <div className="py-2 text-sm text-muted-foreground">
        {isError ? "Failed to load tenants" : "No tenants available"}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Label className="text-xs text-muted-foreground flex items-center gap-1">
        <Building2 className="h-3 w-3" />
        Tenant
      </Label>
      <Select value={selectedTenantId ?? ""} onValueChange={handleTenantChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select tenant" />
        </SelectTrigger>
        <SelectContent>
          {tenants.results.map((tenant) => (
            <SelectItem key={tenant.id} value={tenant.id}>
              {tenant.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
