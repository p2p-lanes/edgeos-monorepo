"use client"

import { useRouter } from "next/navigation"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

interface RedFlagScreenProps {
  userName: string
  popupName: string
  popupSlug: string
}

const RedFlagScreen = ({
  userName,
  popupName,
  popupSlug,
}: RedFlagScreenProps) => {
  const { t } = useTranslation()
  const router = useRouter()

  const handlePortalRedirect = () => {
    router.push(`/portal/${popupSlug}`)
  }

  return (
    <Card className="max-w-lg mx-auto backdrop-blur bg-white/90">
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-center">
          {t("checkout.application_required")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="text-center space-y-4">
          <p className="text-lg">
            {t("checkout.application_required_message", { userName })}
          </p>
          <p className="text-gray-600">
            {t("checkout.application_required_prompt", { popupName })}
          </p>
        </div>

        <Button onClick={handlePortalRedirect} className="w-full" size="lg">
          {t("checkout.go_to_portal")}
        </Button>
      </CardContent>
    </Card>
  )
}

export default RedFlagScreen
