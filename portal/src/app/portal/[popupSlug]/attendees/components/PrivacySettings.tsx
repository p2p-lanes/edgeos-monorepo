"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, SlidersHorizontal } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { ApplicationsService, HumansService } from "@/client"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { queryKeys } from "@/lib/query-keys"
import { useCityProvider } from "@/providers/cityProvider"

const PrivacySettings = () => {
  const { t } = useTranslation()
  const { getCity } = useCityProvider()
  const city = getCity()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [listed, setListed] = useState(false)
  const [sharedFields, setSharedFields] = useState<string[]>([])
  const [attendeeValues, setAttendeeValues] = useState<Record<string, string>>(
    {},
  )
  const queryKey = ["humans", "me", "directory", city?.id] as const
  const settingsQuery = useQuery({
    queryKey,
    queryFn: () => HumansService.getMyDirectorySettings({ popupId: city!.id }),
    enabled: !!city?.id,
    retry: false,
  })
  const valuesQuery = useQuery({
    queryKey: ["attendees", "directory-values", city?.id],
    queryFn: () =>
      ApplicationsService.getMyDirectoryValues({ popupId: city!.id }),
    enabled: !!city?.id,
    retry: false,
  })
  const settings = settingsQuery.data
  const fields = (settingsQuery.data?.available_fields ?? []) as Array<{
    id: string
    label: string
    source?: string
  }>

  const updateMutation = useMutation({
    mutationFn: async () => {
      const configuredValues = Object.fromEntries(
        fields
          .filter((field) => field.source === "attendee")
          .map((field) => [field.id, attendeeValues[field.id] ?? ""]),
      )
      if (Object.keys(configuredValues).length > 0) {
        await ApplicationsService.updateMyDirectoryValues({
          popupId: city!.id,
          requestBody: { values: configuredValues },
        })
      }
      const updatedSettings = await HumansService.updateMyDirectorySettings({
        popupId: city!.id,
        requestBody: { listed, shared_fields: sharedFields },
      })
      return { settings: updatedSettings, values: configuredValues }
    },
    onSuccess: async ({ settings, values }) => {
      queryClient.setQueryData(queryKey, settings)
      queryClient.setQueryData(
        ["attendees", "directory-values", city?.id],
        values,
      )
      await queryClient.invalidateQueries({
        queryKey: queryKeys.attendees.directory(settings.popup_id),
      })
      toast.success(t("attendees.privacy_saved"))
      setOpen(false)
    },
    onError: () => toast.error(t("attendees.privacy_error")),
  })

  useEffect(() => {
    if (settings) {
      setListed(settings.listed)
      setSharedFields(settings.shared_fields)
    }
  }, [settings])

  useEffect(() => {
    if (valuesQuery.data) setAttendeeValues(valuesQuery.data)
  }, [valuesQuery.data])

  if (!city?.id || (settingsQuery.isFetched && !settings)) return null

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen && settings) {
          setListed(settings.listed)
          setSharedFields(settings.shared_fields)
          setAttendeeValues(valuesQuery.data ?? {})
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
        {settingsQuery.isLoading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : settings ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 border-b pb-3">
              <Checkbox
                id="directory-listed"
                checked={listed}
                onCheckedChange={(checked) => setListed(checked === true)}
              />
              <Label htmlFor="directory-listed">
                {t("attendees.directory_listed")}
              </Label>
            </div>
            {fields.map((field) => (
              <div key={field.id} className="space-y-2">
                {field.source === "attendee" && (
                  <div className="space-y-1">
                    <Label htmlFor={`value-${field.id}`}>{field.label}</Label>
                    <Input
                      id={`value-${field.id}`}
                      value={attendeeValues[field.id] ?? ""}
                      onChange={(event) =>
                        setAttendeeValues((current) => ({
                          ...current,
                          [field.id]: event.target.value,
                        }))
                      }
                    />
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <Checkbox
                    id={`share-${field.id}`}
                    checked={sharedFields.includes(field.id)}
                    disabled={!listed}
                    onCheckedChange={(checked) =>
                      setSharedFields((current) =>
                        checked === true
                          ? [...new Set([...current, field.id])]
                          : current.filter((item) => item !== field.id),
                      )
                    }
                  />
                  <Label htmlFor={`share-${field.id}`}>
                    {t("attendees.share_field", { field: field.label })}
                  </Label>
                </div>
              </div>
            ))}
          </div>
        ) : null}
        <DialogFooter>
          <Button
            onClick={() => updateMutation.mutate()}
            disabled={!settings || updateMutation.isPending}
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
