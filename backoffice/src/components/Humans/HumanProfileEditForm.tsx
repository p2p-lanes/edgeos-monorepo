import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"

import { type HumanPublic, HumansService } from "@/client"
import { AGE_OPTIONS, GENDER_OPTIONS } from "@/components/Humans/humanFields"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

/**
 * Compact profile editor for the human detail dialog. Only the human-owned
 * profile fields — email is immutable in edit, and rating is edited inline in
 * the assessment card, so neither belongs here.
 */
export function HumanProfileEditForm({
  human,
  onSuccess,
  onCancel,
}: {
  human: HumanPublic
  onSuccess: () => void
  onCancel: () => void
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const updateMutation = useMutation({
    mutationFn: (
      data: Parameters<typeof HumansService.updateHuman>[0]["requestBody"],
    ) => HumansService.updateHuman({ humanId: human.id, requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Human updated successfully")
      queryClient.invalidateQueries({ queryKey: ["humans"] })
      queryClient.invalidateQueries({ queryKey: ["humans", human.id] })
      onSuccess()
    },
    onError: createErrorHandler(showErrorToast),
  })

  const form = useForm({
    defaultValues: {
      first_name: human.first_name ?? "",
      last_name: human.last_name ?? "",
      telegram: human.telegram ?? "",
      gender: human.gender ?? "",
      age: human.age ?? "",
      residence: human.residence ?? "",
      picture_url: human.picture_url ?? "",
    },
    onSubmit: ({ value }) => {
      updateMutation.mutate({
        first_name: value.first_name || null,
        last_name: value.last_name || null,
        telegram: value.telegram || null,
        gender: value.gender || null,
        age: value.age || null,
        residence: value.residence || null,
        picture_url: value.picture_url || null,
      })
    },
  })

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        form.handleSubmit()
      }}
      className="space-y-4"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="first_name">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>First Name</Label>
              <Input
                id={field.name}
                placeholder="John"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>
        <form.Field name="last_name">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Last Name</Label>
              <Input
                id={field.name}
                placeholder="Doe"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="gender">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Gender</Label>
              <Select
                value={field.state.value}
                onValueChange={(val) => field.handleChange(val)}
              >
                <SelectTrigger id={field.name}>
                  <SelectValue placeholder="Select gender" />
                </SelectTrigger>
                <SelectContent>
                  {GENDER_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </form.Field>
        <form.Field name="age">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Age</Label>
              <Select
                value={field.state.value}
                onValueChange={(val) => field.handleChange(val)}
              >
                <SelectTrigger id={field.name}>
                  <SelectValue placeholder="Select age range" />
                </SelectTrigger>
                <SelectContent>
                  {AGE_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </form.Field>
      </div>

      <form.Field name="residence">
        {(field) => (
          <div className="space-y-2">
            <Label htmlFor={field.name}>Residence</Label>
            <Input
              id={field.name}
              placeholder="City, Country"
              value={field.state.value}
              onChange={(e) => field.handleChange(e.target.value)}
            />
          </div>
        )}
      </form.Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <form.Field name="telegram">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Telegram</Label>
              <Input
                id={field.name}
                placeholder="@username"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>
        <form.Field name="picture_url">
          {(field) => (
            <div className="space-y-2">
              <Label htmlFor={field.name}>Picture URL</Label>
              <Input
                id={field.name}
                placeholder="https://..."
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
              />
            </div>
          )}
        </form.Field>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <LoadingButton type="submit" loading={updateMutation.isPending}>
          Save Changes
        </LoadingButton>
      </div>
    </form>
  )
}
