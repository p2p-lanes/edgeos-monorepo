import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import { type HumanPublic, HumansService, type HumanUpdate } from "@/client"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

interface HumanFormProps {
  defaultValues: HumanPublic
  onSuccess: () => void
}

export function HumanForm({ defaultValues, onSuccess }: HumanFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { isAdmin } = useAuth()

  const updateMutation = useMutation({
    mutationFn: (data: HumanUpdate) =>
      HumansService.updateHuman({
        humanId: defaultValues.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Human updated successfully")
      queryClient.invalidateQueries({ queryKey: ["humans"] })
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
  })

  const form = useForm({
    defaultValues: {
      first_name: defaultValues.first_name ?? "",
      last_name: defaultValues.last_name ?? "",
      telegram: defaultValues.telegram ?? "",
      organization: defaultValues.organization ?? "",
      role: defaultValues.role ?? "",
      gender: defaultValues.gender ?? "",
      age: defaultValues.age ?? "",
      residence: defaultValues.residence ?? "",
      picture_url: defaultValues.picture_url ?? "",
      red_flag: defaultValues.red_flag ?? false,
    },
    onSubmit: ({ value }) => {
      updateMutation.mutate({
        first_name: value.first_name || null,
        last_name: value.last_name || null,
        telegram: value.telegram || null,
        organization: value.organization || null,
        role: value.role || null,
        gender: value.gender || null,
        age: value.age || null,
        residence: value.residence || null,
        picture_url: value.picture_url || null,
        red_flag: value.red_flag,
      })
    },
  })

  const isPending = updateMutation.isPending

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Human Information</CardTitle>
          <CardDescription>Details about this end-user</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-muted-foreground">Email</Label>
            <p className="font-medium">{defaultValues.email}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">ID</Label>
            <p className="font-mono text-sm">{defaultValues.id}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Edit Profile</CardTitle>
          <CardDescription>
            Update the human's profile information
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              form.handleSubmit()
            }}
            className="space-y-6"
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
                      disabled={!isAdmin}
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
                      disabled={!isAdmin}
                    />
                  </div>
                )}
              </form.Field>
            </div>

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
                      disabled={!isAdmin}
                    />
                  </div>
                )}
              </form.Field>

              <form.Field name="organization">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Organization</Label>
                    <Input
                      id={field.name}
                      placeholder="Company name"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={!isAdmin}
                    />
                  </div>
                )}
              </form.Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="role">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Role</Label>
                    <Input
                      id={field.name}
                      placeholder="Developer, Designer, etc."
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={!isAdmin}
                    />
                  </div>
                )}
              </form.Field>

              <form.Field name="gender">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Gender</Label>
                    <Input
                      id={field.name}
                      placeholder="Gender"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={!isAdmin}
                    />
                  </div>
                )}
              </form.Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <form.Field name="age">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Age</Label>
                    <Input
                      id={field.name}
                      placeholder="Age range"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={!isAdmin}
                    />
                  </div>
                )}
              </form.Field>

              <form.Field name="residence">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>Residence</Label>
                    <Input
                      id={field.name}
                      placeholder="City, Country"
                      value={field.state.value}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={!isAdmin}
                    />
                  </div>
                )}
              </form.Field>
            </div>

            <form.Field name="picture_url">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Picture URL</Label>
                  <Input
                    id={field.name}
                    placeholder="https://..."
                    value={field.state.value}
                    onChange={(e) => field.handleChange(e.target.value)}
                    disabled={!isAdmin}
                  />
                </div>
              )}
            </form.Field>

            <form.Field name="red_flag">
              {(field) => (
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id={field.name}
                    checked={field.state.value}
                    onCheckedChange={(checked) =>
                      field.handleChange(checked === true)
                    }
                    disabled={!isAdmin}
                  />
                  <Label
                    htmlFor={field.name}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Red Flag
                  </Label>
                  <span className="text-sm text-muted-foreground">
                    (Mark this user as flagged)
                  </span>
                </div>
              )}
            </form.Field>

            {isAdmin && (
              <div className="flex gap-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate({ to: "/humans" })}
                >
                  Cancel
                </Button>
                <LoadingButton type="submit" loading={isPending}>
                  Save Changes
                </LoadingButton>
              </div>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
