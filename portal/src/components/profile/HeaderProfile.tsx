import { LogOut, Medal, Newspaper } from "lucide-react"
import { useRouter } from "next/navigation"
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
  const router = useRouter()
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false)
  const { logout } = useAuth()
  const { tenant } = useTenant()
  const { getCity } = useCityProvider()
  const city = getCity()
  const hasInvoiceFields = !!city?.invoice_company_name

  return (
    <div className="p-4 md:p-6 border-b border-border bg-card">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-2">
          <SidebarTrigger className="xl:hidden" />
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {t("profile.my_profile")}
            </h1>
            <p className="text-muted-foreground">
              {t("profile.header_subtitle", { tenant: tenant?.name })}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            className="text-foreground border-border bg-transparent"
            onClick={() => router.push("/portal/poaps")}
          >
            <Medal className="mr-2 size-4" />
            {t("profile.my_collectibles")}
          </Button>
          {hasInvoiceFields && (
            <>
              <Button
                variant="outline"
                className="text-foreground border-border hover:bg-muted bg-transparent"
                onClick={() => setIsInvoiceModalOpen(true)}
              >
                <Newspaper className="h-4 w-4" />
                {t("profile.invoices")}
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
