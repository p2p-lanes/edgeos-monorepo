import { BookOpen, Github, Key, Star, User } from "lucide-react"
import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  SidebarFooter,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "./SidebarComponents"

const REPO_URL = "https://github.com/p2p-lanes/EdgeOS"

async function getGitHubStars() {
  try {
    const response = await fetch(
      "https://api.github.com/repos/p2p-lanes/EdgeOS",
    )
    const data = await response.json()
    return data.stargazers_count as number
  } catch (error) {
    console.error("Error fetching GitHub stars:", error)
    return null
  }
}

const FooterMenu = () => {
  const { t } = useTranslation()
  const router = useRouter()
  const [stars, setStars] = useState<number | null>(null)

  useEffect(() => {
    const fetchStars = async () => {
      const count = await getGitHubStars()
      setStars(count)
    }

    fetchStars()
  }, [])

  return (
    <SidebarFooter>
      <SidebarMenu>
        {stars !== null && (
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={() =>
                window.open(REPO_URL, "_blank", "noopener,noreferrer")
              }
            >
              <Github className="size-4" />
              <span className="ml-3 text-xs font-semibold group-data-[collapsible=icon]:hidden">
                EdgeOS
              </span>
              <div className="ml-auto flex items-center gap-1 group-data-[collapsible=icon]:hidden">
                <Star className="size-3.5 fill-amber-400 text-amber-400" />
                <span className="font-medium">{stars}</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        <SidebarMenuItem>
          <SidebarMenuButton
            className="mt-4"
            onClick={() => router.push("/portal/api-keys")}
          >
            <Key className="size-4" />
            <span className="text-sm font-medium">
              {t("sidebar.api_keys", { defaultValue: "API Keys" })}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton onClick={() => router.push("/docs")}>
            <BookOpen className="size-4" />
            <span className="text-sm font-medium">
              {t("sidebar.api_docs", { defaultValue: "API Docs" })}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            className="mb-4"
            onClick={() => router.push("/portal/profile")}
          >
            <User className="size-4" />
            <span className="text-sm font-medium">
              {t("profile.my_profile")}
            </span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarFooter>
  )
}
export default FooterMenu
