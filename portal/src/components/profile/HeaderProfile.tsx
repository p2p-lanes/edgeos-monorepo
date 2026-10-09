import { LogOut, Newspaper } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import InvoiceModal from "@/app/portal/[popupSlug]/passes/components/common/InvoiceModal"
import useAuth from "@/hooks/useAuth"
import { useCityProvider } from "@/providers/cityProvider"
import { useTenant } from "@/providers/tenantProvider"
import { SidebarTrigger } from "../Sidebar/SidebarComponents"
import { Button } from "../ui/button"

const HeaderProfile = () => {
  const { t } = useTranslation()
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false)
  const { logout } = useAuth()
  const { tenant } = useTenant()
  const { getCity } = useCityProvider()
  const city = getCity()
  const hasInvoiceFields = !!city?.invoice_company_name

  return (
    <div className="p-4 md:p-6 border-b border-border bg-card">
      {/* One row at every width: on phones the actions used to drop to a
          lonely second row and the sidebar trigger floated beside the
          two-line title. The trigger and actions now align with the title
          line and the invoices button collapses to its icon. */}
      <div className="flex items-start gap-2 md:items-center md:gap-4">
        <SidebarTrigger className="mt-0.5 shrink-0 md:mt-0 xl:hidden" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-bold text-foreground">
            {t("profile.my_profile")}
          </h1>
          <p className="text-muted-foreground">
            {t("profile.header_subtitle", { tenant: tenant?.name })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 md:gap-3">
          {hasInvoiceFields && (
            <>
              <Button
                variant="outline"
                aria-label={t("profile.invoices")}
                className="text-foreground border-border hover:bg-muted bg-transparent"
                onClick={() => setIsInvoiceModalOpen(true)}
              >
                <Newspaper className="h-4 w-4" />
                <span className="hidden sm:inline">
                  {t("profile.invoices")}
                </span>
              </Button>
              <InvoiceModal
                isOpen={isInvoiceModalOpen}
                onClose={() => setIsInvoiceModalOpen(false)}
              />
            </>
          )}

          <div className="hidden md:block h-6 w-px bg-muted" />

          <Button
            variant="outline"
            className="text-foreground border-border hover:bg-muted bg-transparent"
            onClick={() => logout()}
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
export default HeaderProfile
