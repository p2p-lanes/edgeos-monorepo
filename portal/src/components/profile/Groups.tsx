import { Check, Copy } from "lucide-react"
import { useRouter } from "next/navigation"
import { useState } from "react"
import { toast } from "sonner"
import type { GroupPublic } from "@/client"
import { getPublicGroupLink } from "@/lib/group-route"
import { useCityProvider } from "@/providers/cityProvider"
import useGetGroups from "../Sidebar/hooks/useGetGroups"
import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import { Card } from "../ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"

const getCheckoutLinkForGroup = (group: GroupPublic): string => {
  return getPublicGroupLink(window.location.origin, group.slug)
}

const Groups = () => {
  const { data: groups = [] } = useGetGroups()
  const router = useRouter()
  const { getPopups } = useCityProvider()
  const popups = getPopups()

  if (groups.length === 0) return null

  return (
    <div className="bg-white rounded-lg border border-gray-200 mb-8">
      <div className="p-6 border-b border-gray-200">
        <h2 className="text-xl font-semibold text-gray-900">Groups</h2>
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
                    <h3 className="font-semibold text-gray-900">
                      {group.name}
                    </h3>
                    {/* LEGACY: popup_name removed from API – review for deletion */}
                    <Badge variant={"outline"} className="w-fit mt-1">
                      {group.is_ambassador_group ? "Ambassador" : "Group"}
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
  group: GroupPublic
  isPopupActive: boolean
}) => {
  const [isCopied, setIsCopied] = useState(false)

  // Don't render button if popup is not active
  if (!isPopupActive) return null

  const handleCopyCheckoutLink = async (group: GroupPublic) => {
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
