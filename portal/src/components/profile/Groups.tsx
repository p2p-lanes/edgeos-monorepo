import { Check, Copy } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { MyGroupPublic } from "@/client"
import { getPublicGroupLink } from "@/lib/group-route"
import { useCityProvider } from "@/providers/cityProvider"
import useGetGroups from "../Sidebar/hooks/useGetGroups"
import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import { Card } from "../ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"

const getCheckoutLinkForGroup = (group: MyGroupPublic): string => {
  return getPublicGroupLink(window.location.origin, group.slug)
}

const Groups = () => {
  const { data: groups = [] } = useGetGroups()
  const { t } = useTranslation()
  const router = useRouter()
  const { getPopups } = useCityProvider()
  const popups = getPopups()

  if (groups.length === 0) return null

  const getRoleBadgeLabel = (group: MyGroupPublic): string => {
    if (group.is_ambassador_group) return t("groups.role_ambassador")
    if (group.is_leader) return t("groups.role_leader")
    return t("groups.role_member")
  }

  return (
    <div className="bg-card rounded-lg border border-border mb-8">
      <div className="p-6 border-b border-border">
        <h2 className="text-xl font-semibold text-foreground">Groups</h2>
      </div>

      <div className="p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((group) => {
            const groupPopup = popups.find(
              (popup) => popup.id === group.popup_id,
            )
            const isPopupActive = groupPopup?.status === "active"

            return (
              <Card
                key={group.id}
                className={`p-4 hover:shadow-md transition-shadow ${isPopupActive ? "cursor-pointer" : ""}`}
                onClick={
                  isPopupActive
                    ? () =>
                        router.push(
                          `/portal/${groupPopup?.slug}/groups/${group.id}`,
                        )
                    : undefined
                }
              >
                <div className="flex justify-between items-center">
                  <div className="flex flex-col gap-2">
                    <h3 className="font-semibold text-foreground">
                      {group.name}
                    </h3>
                    <Badge variant={"outline"} className="w-fit mt-1">
                      {getRoleBadgeLabel(group)}
                    </Badge>
                  </div>
                  <ButtonCopyLink group={group} isPopupActive={isPopupActive} />
                </div>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export const ButtonCopyLink = ({
  group,
  isPopupActive,
}: {
  group: MyGroupPublic
  isPopupActive: boolean
}) => {
  const [isCopied, setIsCopied] = useState(false)

  // Don't render button if popup is not active
  if (!isPopupActive) return null

  const handleCopyCheckoutLink = async (group: MyGroupPublic) => {
    const checkoutLink = getCheckoutLinkForGroup(group)

    try {
      await navigator.clipboard.writeText(checkoutLink)
      setIsCopied(true)
      toast.success("Checkout link copied to clipboard!")

      // Reset copied state after 2 seconds
      setTimeout(() => {
        setIsCopied(false)
      }, 2000)
    } catch (error) {
      console.error("Failed to copy:", error)
      toast.error("Failed to copy link to clipboard")
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="sm"
          onClick={(e) => {
            e.stopPropagation()
            handleCopyCheckoutLink(group)
          }}
        >
          {isCopied ? (
            <Check className="w-3 h-3" />
          ) : (
            <Copy className="w-3 h-3" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>Copy Checkout Link</TooltipContent>
    </Tooltip>
  )
}

export default Groups
