import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { FolderTree, Palette, Repeat } from "lucide-react"
import { useRef, useState } from "react"

import { type BadgePublic, BadgesService } from "@/client"
import {
  BadgeStylesDialog,
  useBadgeStyles,
} from "@/components/Badges/BadgeStylesDialog"
import { FieldError } from "@/components/Common/FieldError"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { ImageUpload } from "@/components/ui/image-upload"
import {
  HeroInput,
  InlineRow,
  InlineSection,
} from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import {
  UnsavedChangesDialog,
  useUnsavedChanges,
} from "@/hooks/useUnsavedChanges"
import { createErrorHandler } from "@/utils"

const DEFAULT_STYLE = "__default__"

type ImageMap = Record<string, string | null>

interface BadgeFormValues {
  name: string
  description: string
  category: string
  repeatable: boolean
  style_override_id: string
  images: ImageMap
}

interface BadgeFormProps {
  defaultValues?: BadgePublic
  onSuccess: () => void
}

function imagesOf(badge?: BadgePublic): ImageMap {
  return Object.fromEntries(
    (badge?.images ?? []).map((img) => [img.style_id, img.image_url]),
  )
}

export function BadgeForm({ defaultValues, onSuccess }: BadgeFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { isOperatorOrAbove } = useAuth()
  const { data: styles = [] } = useBadgeStyles()
  const [stylesOpen, setStylesOpen] = useState(false)
  const isEdit = !!defaultValues
  const readOnly = !isOperatorOrAbove
  const skipBlockerRef = useRef(false)
  // Once awarded, repeatable is locked server-side (awards snapshot it).
  const repeatableLocked = isEdit && (defaultValues.award_count ?? 0) > 0

  const done = (message: string) => {
    showSuccessToast(message)
    queryClient.invalidateQueries({ queryKey: ["badges"] })
    skipBlockerRef.current = true
    form.reset()
    onSuccess()
  }

  const mutation = useMutation({
    mutationFn: async (value: BadgeFormValues) => {
      const fields = {
        name: value.name.trim(),
        description: value.description.trim() || null,
        category: value.category.trim() || null,
        style_override_id:
          value.style_override_id === DEFAULT_STYLE
            ? null
            : value.style_override_id,
      }
      const wanted = Object.entries(value.images).filter(
        (entry): entry is [string, string] => !!entry[1],
      )
      if (!isEdit) {
        return BadgesService.createBadge({
          requestBody: {
            ...fields,
            repeatable: value.repeatable,
            images: wanted.map(([style_id, image_url]) => ({
              style_id,
              image_url,
            })),
          },
        })
      }

      const badgeId = defaultValues.id
      await BadgesService.updateBadge({
        badgeId,
        requestBody: {
          ...fields,
          ...(repeatableLocked ? {} : { repeatable: value.repeatable }),
        },
      })
      // Upload new artwork before removing old artwork: a badge must keep
      // at least one image at every step.
      const before = imagesOf(defaultValues)
      for (const [styleId, url] of wanted) {
        if (before[styleId] !== url) {
          await BadgesService.putBadgeImage({
            badgeId,
            styleId,
            requestBody: { image_url: url },
          })
        }
      }
      for (const styleId of Object.keys(before)) {
        if (!value.images[styleId]) {
          await BadgesService.deleteBadgeImage({ badgeId, styleId })
        }
      }
      return BadgesService.getBadge({ badgeId })
    },
    onSuccess: () => done(isEdit ? "Badge updated" : "Badge created"),
    onError: createErrorHandler(showErrorToast),
  })

  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? "",
      description: defaultValues?.description ?? "",
      category: defaultValues?.category ?? "",
      repeatable: defaultValues?.repeatable ?? false,
      style_override_id: defaultValues?.style_override_id ?? DEFAULT_STYLE,
      images: imagesOf(defaultValues),
    } as BadgeFormValues,
    onSubmit: ({ value }) => {
      if (readOnly) return
      if (!value.name.trim()) {
        showErrorToast("A badge needs a name")
        return
      }
      if (!Object.values(value.images).some(Boolean)) {
        showErrorToast("Add the badge's artwork in at least one style")
        return
      }
      mutation.mutate(value)
    },
  })

  const blocker = useUnsavedChanges(form, skipBlockerRef)

  return (
    <div className="space-y-6">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (!readOnly) form.handleSubmit()
        }}
        className="mx-auto max-w-2xl space-y-6"
      >
        <form.Field
          name="name"
          validators={{
            onBlur: ({ value }) =>
              !readOnly && !value.trim() ? "Name is required" : undefined,
          }}
        >
          {(field) => (
            <div>
              <HeroInput
                placeholder="Badge name"
                value={field.state.value}
                onBlur={field.handleBlur}
                onChange={(e) => field.handleChange(e.target.value)}
                disabled={readOnly}
              />
              <FieldError errors={field.state.meta.errors} />
            </div>
          )}
        </form.Field>

        <form.Field name="description">
          {(field) => (
            <Textarea
              placeholder="What is this badge for? Shown on profiles."
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
              disabled={readOnly}
              rows={3}
            />
          )}
        </form.Field>

        <Separator />

        <InlineSection title="Settings">
          <form.Field name="category">
            {(field) => (
              <InlineRow
                icon={<FolderTree className="h-4 w-4 text-muted-foreground" />}
                label="Category"
                description="Groups badges in the catalog, e.g. Wellbeing"
              >
                <Input
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  disabled={readOnly}
                  className="max-w-48 text-sm"
                />
              </InlineRow>
            )}
          </form.Field>

          <form.Field name="repeatable">
            {(field) => (
              <InlineRow
                icon={<Repeat className="h-4 w-4 text-muted-foreground" />}
                label="Repeatable"
                description={
                  repeatableLocked
                    ? "Locked: this badge was already awarded"
                    : "Can be received many times, like a gold star"
                }
              >
                <Switch
                  checked={field.state.value}
                  onCheckedChange={(val) => field.handleChange(val)}
                  disabled={readOnly || repeatableLocked}
                />
              </InlineRow>
            )}
          </form.Field>

          <form.Field name="style_override_id">
            {(field) => (
              <InlineRow
                icon={<Palette className="h-4 w-4 text-muted-foreground" />}
                label="Style"
                description="Which artwork this badge shows"
              >
                <Select
                  value={field.state.value}
                  onValueChange={(val) => field.handleChange(val)}
                  disabled={readOnly}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_STYLE}>
                      Collection default
                    </SelectItem>
                    {styles.map((style) => (
                      <SelectItem key={style.id} value={style.id}>
                        {style.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </InlineRow>
            )}
          </form.Field>
        </InlineSection>

        <Separator />

        <InlineSection
          title="Artwork"
          description="One image per style. Square images with a transparent background work best."
        >
          {styles.length === 0 ? (
            <Alert>
              <AlertDescription className="flex flex-wrap items-center gap-2">
                Add a style before uploading artwork.
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setStylesOpen(true)}
                >
                  Manage styles
                </Button>
              </AlertDescription>
            </Alert>
          ) : (
            <form.Field name="images">
              {(field) => (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {styles.map((style) => (
                    <div key={style.id} className="space-y-2">
                      <p className="text-sm font-medium">
                        {style.name}
                        {style.is_default && (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            default
                          </span>
                        )}
                      </p>
                      <ImageUpload
                        value={field.state.value[style.id] ?? null}
                        onChange={(url) =>
                          field.handleChange({
                            ...field.state.value,
                            [style.id]: url,
                          })
                        }
                        disabled={readOnly}
                      />
                    </div>
                  ))}
                </div>
              )}
            </form.Field>
          )}
        </InlineSection>

        <Separator />

        <div className="flex gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/badges" })}
          >
            {readOnly ? "Back" : "Cancel"}
          </Button>
          {!readOnly && (
            <LoadingButton type="submit" loading={mutation.isPending}>
              {isEdit ? "Save Changes" : "Create Badge"}
            </LoadingButton>
          )}
        </div>
      </form>

      <BadgeStylesDialog open={stylesOpen} onOpenChange={setStylesOpen} />
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}
