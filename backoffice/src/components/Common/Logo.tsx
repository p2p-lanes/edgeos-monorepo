import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"

import { TenantsService } from "@/client"
import { useTheme } from "@/components/theme-provider"
import { useOptionalWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import { cn } from "@/lib/utils"

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
  const workspace = useOptionalWorkspace()
  const effectiveTenantId = workspace?.effectiveTenantId
  const isDark = resolvedTheme === "dark"

  const { data: tenant, isError: _tenantError } = useQuery({
    queryKey: ["tenants", effectiveTenantId],
    queryFn: () => TenantsService.getTenant({ tenantId: effectiveTenantId! }),
    enabled: !!effectiveTenantId && !isSuperadmin,
    staleTime: 5 * 60 * 1000,
  })

  const tenantLogo = tenant?.logo_url

  const shouldUseTenantLogo = !isSuperadmin && !!tenantLogo

  const altText = tenant?.name || "EdgeOS"

  // Default EdgeOS logo: wordmark matching the marketing site navbar —
  // display font, tight tracking, "OS" in the EdgeOS accent blue.
  const DefaultFullLogo = ({
    className: logoClassName,
  }: {
    className?: string
  }) => (
    <span
      className={cn(
        "font-display inline-flex items-center text-xl font-bold tracking-tight text-white",
        logoClassName,
      )}
    >
      Edge
      <span className="text-[#2d62ff]">OS</span>
    </span>
  )

  const DefaultIconLogo = ({
    className: iconClassName,
  }: {
    className?: string
  }) => (
    <span
      role="img"
      aria-label={altText}
      className={cn(
        "font-display flex size-10 items-center justify-center rounded-lg bg-[#2d62ff] text-lg font-bold text-white",
        iconClassName,
      )}
    >
      E
    </span>
  )

  // Tenant full logo: logo image + tenant name
  const TenantFullLogo = ({
    className: logoClassName,
  }: {
    className?: string
  }) => (
    <div className={cn("flex items-center gap-2", logoClassName)}>
      <img src={tenantLogo!} alt={altText} className="size-8 object-contain" />
      <span
        className={cn(
          "text-xl font-semibold truncate",
          isDark ? "text-slate-50" : "text-slate-900",
        )}
      >
        {tenant?.name}
      </span>
    </div>
  )

  // Tenant icon logo: logo image only
  const TenantIconLogo = ({
    className: iconClassName,
  }: {
    className?: string
  }) => (
    <img
      src={tenantLogo!}
      alt={altText}
      className={cn("size-10 object-contain", iconClassName)}
    />
  )

  const content =
    variant === "responsive" ? (
      <>
        {shouldUseTenantLogo ? (
          <div className="group-data-[collapsible=icon]:hidden">
            <TenantFullLogo className={className} />
          </div>
        ) : (
          <div className="group-data-[collapsible=icon]:hidden">
            <DefaultFullLogo className={className} />
          </div>
        )}
        {shouldUseTenantLogo ? (
          <div className="hidden group-data-[collapsible=icon]:block">
            <TenantIconLogo className={className} />
          </div>
        ) : (
          <div className="hidden group-data-[collapsible=icon]:block">
            <DefaultIconLogo className={className} />
          </div>
        )}
      </>
    ) : variant === "full" ? (
      shouldUseTenantLogo ? (
        <TenantFullLogo className={className} />
      ) : (
        <DefaultFullLogo className={className} />
      )
    ) : shouldUseTenantLogo ? (
      <TenantIconLogo className={className} />
    ) : (
      <DefaultIconLogo className={className} />
    )

  if (!asLink) {
    return content
  }

  return <Link to="/">{content}</Link>
}
