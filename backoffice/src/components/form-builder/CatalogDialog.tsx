import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus } from "lucide-react"
import { useMemo } from "react"
import { type CatalogField, FormFieldsService } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Skeleton } from "@/components/ui/skeleton"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

const SECTION_LABELS: Record<string, string> = {
  profile: "Personal Information",
  info_not_shared: "Info not shared",
  companions: "Children and +1s",
  scholarship: "Scholarship",
}

interface CatalogDialogProps {
  popupId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CatalogDialog({
  popupId,
  open,
  onOpenChange,
}: CatalogDialogProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const { data, isLoading } = useQuery({
    queryKey: ["form-fields", popupId, "catalog"],
    queryFn: () =>
      FormFieldsService.listAvailableBaseFields({ popupId }),
    enabled: open,
  })

  const addMutation = useMutation({
    mutationFn: (fieldName: string) =>
      FormFieldsService.createBaseFieldConfig({ popupId, fieldName }),
    onSuccess: (_created, fieldName) => {
      const label =
        data?.find((f) => f.field_name === fieldName)?.label ?? fieldName
      showSuccessToast(`"${label}" added to the popup`)
      queryClient.invalidateQueries({ queryKey: ["form-fields"] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const grouped = useMemo(() => {
    if (!data) return [] as Array<{ key: string; fields: CatalogField[] }>
    const bySection: Record<string, CatalogField[]> = {}
    for (const field of data) {
      const key = field.default_section_key ?? "other"
      if (!bySection[key]) bySection[key] = []
      bySection[key].push(field)
    }
    const order = ["profile", "info_not_shared", "companions", "scholarship"]
    const sortedKeys = Object.keys(bySection).sort((a, b) => {
      const ai = order.indexOf(a)
      const bi = order.indexOf(b)
      if (ai === -1 && bi === -1) return a.localeCompare(b)
      if (ai === -1) return 1
      if (bi === -1) return -1
      return ai - bi
    })
    return sortedKeys.map((key) => ({ key, fields: bySection[key] }))
  }, [data])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add a predefined field</DialogTitle>
          <DialogDescription>
            These fields come from the base catalog. Click one to add it to
            this popup.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2 py-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : grouped.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Every available field is already in this popup.
          </p>
        ) : (
          <div className="max-h-[60vh] space-y-4 overflow-y-auto py-2">
            {grouped.map(({ key, fields }) => (
              <div key={key} className="space-y-1.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {SECTION_LABELS[key] ?? key}
                </p>
                <div className="space-y-1">
                  {fields.map((field) => (
                    <Button
                      key={field.field_name}
                      type="button"
                      variant="ghost"
                      className="w-full justify-start gap-2 h-auto py-2"
                      disabled={addMutation.isPending}
                      onClick={() =>
                        addMutation.mutate(field.field_name)
                      }
                    >
                      <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex flex-col items-start gap-0.5 text-left">
                        <span className="text-sm font-medium">
                          {field.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {field.type}
                          {field.required ? " · required by default" : ""}
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
