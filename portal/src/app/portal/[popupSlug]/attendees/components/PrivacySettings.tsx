"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, SlidersHorizontal } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { type ApplicationPublic, ApplicationsService } from "@/client"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { queryKeys } from "@/lib/query-keys"
import { useCityProvider } from "@/providers/cityProvider"

const SHAREABLE_FIELDS = [
  "first_name",
  "last_name",
  "email",
  "telegram",
  "role",
  "organization",
] as const

const isFieldHidden = (fields: string[], field: string) =>
  fields.some((item) => item.trim().toLowerCase() === field)

const PrivacySettings = () => {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const city = getCity()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [hiddenFields, setHiddenFields] = useState<string[]>([])
  const applicationQueryKey = [
    ...queryKeys.applications.mine(),
    "popup",
    city?.id,
    "primary",
  ] as const
  const applicationQuery = useQuery({
    queryKey: applicationQueryKey,
    queryFn: () =>
      ApplicationsService.getMyApplication({
        popupId: city!.id,
        primaryFlowOnly: true,
      }),
    enabled: !!city?.id && open,
  })

  const updateMutation = useMutation({
    mutationFn: () => {
      const application = applicationQuery.data
      if (!application?.sales_flow_id || !city?.id) {
        throw new Error("Application is unavailable")
      }
      return ApplicationsService.updateMyApplication({
        popupId: city.id,
        salesFlowId: application.sales_flow_id,
        requestBody: { info_not_shared: hiddenFields },
      })
    },
    onSuccess: async (application) => {
      queryClient.setQueryData(applicationQueryKey, application)
      queryClient.setQueryData<ApplicationPublic[]>(
        queryKeys.applications.mine(),
        (current) =>
          current?.map((item) =>
            item.id === application.id ? application : item,
          ),
      )
      setHiddenFields(application.info_not_shared ?? [])
      await queryClient.invalidateQueries({
        queryKey: queryKeys.attendees.directory(application.popup_id),
      })
      toast.success(t("attendees.privacy_saved"))
      setOpen(false)
    },
    onError: () => toast.error(t("attendees.privacy_error")),
  })

  const application = applicationQuery.data

  useEffect(() => {
    if (application) setHiddenFields(application.info_not_shared ?? [])
  }, [application])

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen && application) {
          setHiddenFields(application.info_not_shared ?? [])
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className="shrink-0">
          <SlidersHorizontal className="mr-2 h-4 w-4" />
          {t("attendees.privacy_button")}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("attendees.privacy_title")}</DialogTitle>
          <DialogDescription>
            {t("attendees.privacy_description")}
          </DialogDescription>
        </DialogHeader>
        {applicationQuery.isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : application ? (
          <div className="space-y-3">
            {SHAREABLE_FIELDS.map((field) => (
              <div key={field} className="flex items-center gap-3">
                <Checkbox
                  id={`share-${field}`}
                  checked={!isFieldHidden(hiddenFields, field)}
                  onCheckedChange={(checked) =>
                    setHiddenFields((current) =>
                      checked
                        ? current.filter(
                            (item) => item.trim().toLowerCase() !== field,
                          )
                        : isFieldHidden(current, field)
                          ? current
                          : [...current, field],
                    )
                  }
                />
                <Label htmlFor={`share-${field}`}>
                  {t(`attendees.fields.${field}`)}
                </Label>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t("attendees.privacy_no_application")}
          </p>
        )}
        <DialogFooter>
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={!application || updateMutation.isPending}
          >
            {updateMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            {t("attendees.privacy_save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default PrivacySettings
