import {
  Building2,
  Calendar,
  CreditCard,
  FileText,
  FormInput,
  Home,
  Package,
  Tag,
  User,
  Users,
  UsersRound,
} from "lucide-react"

import { SidebarAppearance } from "@/components/Common/Appearance"
import { Logo } from "@/components/Common/Logo"
import { Separator } from "@/components/ui/separator"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
} from "@/components/ui/sidebar"
import useAuth from "@/hooks/useAuth"
import { type Item, Main } from "./Main"
import { User as UserComponent } from "./User"
import { WorkspaceSelector } from "./WorkspaceSelector"

// Helper to get admin items with dynamic tenant link
function getAdminItems(tenantId: string | null | undefined): Item[] {
  const items: Item[] = [{ icon: Users, title: "Users", path: "/admin" }]
  if (tenantId) {
    items.push({
      icon: Building2,
      title: "Tenant",
      path: `/tenants/${tenantId}/edit`,
    })
  }
  return items
}

// Core navigation items for all users
const coreItems: Item[] = [{ icon: Home, title: "Dashboard", path: "/" }]

const popupItems: Item[] = [
  { icon: Calendar, title: "Popups", path: "/popups" },
  { icon: Package, title: "Products", path: "/products" },
  { icon: Tag, title: "Coupons", path: "/coupons" },
  { icon: UsersRound, title: "Groups", path: "/groups" },
  { icon: FormInput, title: "Form Builder", path: "/form-builder" },
]

// Registration/attendee items
const registrationItems: Item[] = [
  { icon: FileText, title: "Applications", path: "/applications" },
  { icon: Users, title: "Attendees", path: "/attendees" },
  { icon: User, title: "Humans", path: "/humans" },
  { icon: CreditCard, title: "Payments", path: "/payments" },
]

// Admin items (admins and superadmins)
const adminItems: Item[] = [{ icon: Users, title: "Users", path: "/admin" }]

// Superadmin only items - Tenants list view
const superadminItems: Item[] = [
  { icon: Building2, title: "Tenants", path: "/tenants" },
]

export function AppSidebar() {
  const { user: currentUser, isAdmin, isSuperadmin } = useAuth()

  // For admins (non-superadmin), get their tenant-specific items
  const adminNavigationItems =
    isAdmin && !isSuperadmin
      ? getAdminItems(currentUser?.tenant_id)
      : adminItems

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="px-4 py-6 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:items-center">
        <Logo variant="responsive" />
      </SidebarHeader>
      <SidebarContent>
        {/* Workspace context selector */}
        <WorkspaceSelector />
        <Separator className="mx-2 group-data-[collapsible=icon]:hidden" />

        {/* Core navigation */}
        <Main items={coreItems} />

        {/* Popup management section */}
        <SidebarGroup>
          <SidebarGroupLabel>Popup Management</SidebarGroupLabel>
          <Main items={popupItems} />
        </SidebarGroup>

        {/* Registration section */}
        <SidebarGroup>
          <SidebarGroupLabel>Registrations</SidebarGroupLabel>
          <Main items={registrationItems} />
        </SidebarGroup>

        {/* Admin section (visible to admins+) */}
        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Administration</SidebarGroupLabel>
            <Main items={adminNavigationItems} />
            {isSuperadmin && <Main items={superadminItems} />}
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <SidebarAppearance />
        <UserComponent user={currentUser} />
      </SidebarFooter>
    </Sidebar>
  )
}

export default AppSidebar
