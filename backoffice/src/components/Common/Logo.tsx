import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { TenantsService } from "@/client"
import { useTheme } from "@/components/theme-provider"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

import edgeosIcon from "/assets/images/edgeos-icon.svg"
import edgeosIconLight from "/assets/images/edgeos-icon-light.svg"
import edgeosLogo from "/assets/images/edgeos-logo.svg"
import edgeosLogoLight from "/assets/images/edgeos-logo-light.svg"

interface LogoProps {
  variant?: "full" | "icon" | "responsive"
  className?: string
  asLink?: boolean
}

export function Logo({
  variant = "full",
  className,
  asLink = true,
}: LogoProps) {
  const { resolvedTheme } = useTheme()
  const { isSuperadmin } = useAuth()
  const { effectiveTenantId } = useWorkspace()
  const isDark = resolvedTheme === "dark"

  const { data: tenant, isError: _tenantError } = useQuery({
    queryKey: ["tenants", effectiveTenantId],
    queryFn: () => TenantsService.getTenant({ tenantId: effectiveTenantId! }),
    enabled: !!effectiveTenantId && !isSuperadmin,
    staleTime: 5 * 60 * 1000,
  })

  const defaultFullLogo = isDark ? edgeosLogoLight : edgeosLogo
  const defaultIconLogo = isDark ? edgeosIconLight : edgeosIcon

  const tenantLogo = tenant?.image_url
  const tenantIcon = tenant?.icon_url

  const shouldUseTenantLogo = !isSuperadmin && (tenantLogo || tenantIcon)

  const fullLogo =
    shouldUseTenantLogo && tenantLogo ? tenantLogo : defaultFullLogo
  const iconLogo =
    shouldUseTenantLogo && tenantIcon ? tenantIcon : defaultIconLogo

  const altText = tenant?.name || "EdgeOS"

  const content =
    variant === "responsive" ? (
      <>
        <img
          src={fullLogo}
          alt={altText}
          className={cn(
            "h-10 w-auto object-contain group-data-[collapsible=icon]:hidden",
            className,
          )}
        />
        <img
          src={iconLogo}
          alt={altText}
          className={cn(
            "size-10 object-contain hidden group-data-[collapsible=icon]:block",
            className,
          )}
        />
      </>
    ) : (
      <img
        src={variant === "full" ? fullLogo : iconLogo}
        alt={altText}
        className={cn(
          variant === "full"
            ? "h-10 w-auto object-contain"
            : "size-10 object-contain",
          className,
        )}
      />
    )

  if (!asLink) {
    return content
  }

  return <Link to="/">{content}</Link>
}
