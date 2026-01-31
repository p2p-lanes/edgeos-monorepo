import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useMatches,
} from "@tanstack/react-router"
import { ChevronRight, Home } from "lucide-react"
import { Fragment } from "react"

import AppSidebar from "@/components/Sidebar/AppSidebar"
import { Separator } from "@/components/ui/separator"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { isLoggedIn } from "@/hooks/useAuth"

export const Route = createFileRoute("/_layout")({
  component: Layout,
  beforeLoad: async () => {
    if (!isLoggedIn()) {
      throw redirect({
        to: "/login",
      })
    }
  },
})

const routeLabels: Record<string, string> = {
  admin: "Users",
  popups: "Popups",
  products: "Products",
  coupons: "Coupons",
  groups: "Groups",
  "form-builder": "Form Builder",
  applications: "Applications",
  attendees: "Attendees",
  humans: "Humans",
  payments: "Payments",
  tenants: "Tenants",
  settings: "Settings",
  new: "New",
  edit: "Edit",
}

function Breadcrumbs() {
  const matches = useMatches()

  const breadcrumbs = matches
    .filter((match) => match.pathname !== "/_layout")
    .map((match) => {
      const pathname = match.pathname
      const segments = pathname.split("/").filter(Boolean)
      const lastSegment = segments[segments.length - 1]

      if (!lastSegment) {
        return null
      }

      // Check if it's a UUID (for edit pages)
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          lastSegment,
        )

      let label = routeLabels[lastSegment] || lastSegment
      if (isUuid) {
        label = "Details"
      }

      return {
        path: pathname,
        label: label.charAt(0).toUpperCase() + label.slice(1),
      }
    })
    .filter(
      (crumb): crumb is { path: string; label: string } =>
        crumb !== null && crumb.path !== "/",
    )
    .filter(
      (crumb, index, arr) =>
        arr.findIndex((c) => c.path === crumb.path) === index,
    )

  if (breadcrumbs.length === 0) {
    return null
  }

  return (
    <nav className="flex items-center gap-1 text-sm">
      <Link
        to="/"
        className="text-muted-foreground hover:text-foreground transition-colors"
      >
        <Home className="h-4 w-4" />
      </Link>
      {breadcrumbs.map((crumb, index) => (
        <Fragment key={crumb.path}>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
          {index === breadcrumbs.length - 1 ? (
            <span className="font-medium text-foreground">{crumb.label}</span>
          ) : (
            <Link
              to={crumb.path}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {crumb.label}
            </Link>
          )}
        </Fragment>
      ))}
    </nav>
  )
}

function Layout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center gap-2 border-b bg-background px-4">
          <SidebarTrigger className="-ml-1 text-muted-foreground" />
          <Separator orientation="vertical" className="h-4" />
          <Breadcrumbs />
        </header>
        <main className="flex-1 p-6 md:p-8">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default Layout
