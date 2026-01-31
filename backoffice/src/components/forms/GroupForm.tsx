import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import {
  type GroupAdminUpdate,
  type GroupCreate,
  type GroupPublic,
  GroupsService,
} from "@/client"
import { DangerZone } from "@/components/Common/DangerZone"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

interface GroupFormProps {
  defaultValues?: GroupPublic
  onSuccess: () => void
}

export function GroupForm({ defaultValues, onSuccess }: GroupFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { selectedPopupId, isContextReady } = useWorkspace()
  const { isAdmin } = useAuth()
  const isEdit = !!defaultValues
  const readOnly = !isAdmin

  const createMutation = useMutation({
    mutationFn: (data: GroupCreate) =>
      GroupsService.createGroup({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast("Group created successfully")
      queryClient.invalidateQueries({ queryKey: ["groups"] })
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: (data: GroupAdminUpdate) =>
      GroupsService.updateGroup({
        groupId: defaultValues!.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Group updated successfully")
      queryClient.invalidateQueries({ queryKey: ["groups"] })
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: () => GroupsService.deleteGroup({ groupId: defaultValues!.id }),
    onSuccess: () => {
      showSuccessToast("Group deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["groups"] })
      navigate({ to: "/groups" })
    },
    onError: handleError.bind(showErrorToast),
  })

  const form = useForm({
    defaultValues: {
      name: defaultValues?.name ?? "",
      description: defaultValues?.description ?? "",
      discount_percentage:
        defaultValues?.discount_percentage?.toString() ?? "0",
      max_members: defaultValues?.max_members?.toString() ?? "",
      welcome_message: defaultValues?.welcome_message ?? "",
      is_ambassador_group: defaultValues?.is_ambassador_group ?? false,
    },
    onSubmit: ({ value }) => {
      if (readOnly) return
      if (isEdit) {
        updateMutation.mutate({
          name: value.name,
          description: value.description || undefined,
          discount_percentage: Number(value.discount_percentage) || 0,
          max_members: value.max_members ? Number(value.max_members) : null,
          welcome_message: value.welcome_message || undefined,
          is_ambassador_group: value.is_ambassador_group,
        })
      } else {
        if (!selectedPopupId) {
          showErrorToast("Please select a popup first")
          return
        }
        createMutation.mutate({
          popup_id: selectedPopupId,
          name: value.name,
          description: value.description || undefined,
          discount_percentage: Number(value.discount_percentage) || 0,
          max_members: value.max_members
            ? Number(value.max_members)
            : undefined,
          welcome_message: value.welcome_message || undefined,
          is_ambassador_group: value.is_ambassador_group,
        })
      }
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  // Show alert if no popup selected (only for create mode)
  if (!isEdit && !isContextReady) {
    return <WorkspaceAlert resource="group" action="create" />
  }

  return (
    <div className="space-y-6">
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>
            {readOnly
              ? "Group Details"
              : isEdit
                ? "Edit Group"
                : "Group Details"}
          </CardTitle>
          <CardDescription>
            {readOnly
              ? "View group information (read-only)"
              : isEdit
                ? "Update the group settings"
                : "Enter the information for the new registration group"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!readOnly) {
                form.handleSubmit()
              }
            }}
            className="space-y-6"
          >
            <form.Field
              name="name"
              validators={{
                onBlur: ({ value }) =>
                  !readOnly && !value ? "Name is required" : undefined,
              }}
            >
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="name">
                    Name{" "}
                    {!readOnly && <span className="text-destructive">*</span>}
                  </Label>
                  <Input
                    id="name"
                    placeholder="VIP Group"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    disabled={readOnly}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">
                      {field.state.meta.errors.join(", ")}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="description">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    placeholder="Group description..."
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    disabled={readOnly}
                  />
                </div>
              )}
            </form.Field>

            <div className="grid gap-6 md:grid-cols-2">
              <form.Field name="discount_percentage">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="discount_percentage">Discount %</Label>
                    <Input
                      id="discount_percentage"
                      type="number"
                      min={0}
                      max={100}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={readOnly}
                    />
                    <p className="text-sm text-muted-foreground">
                      Discount for group members
                    </p>
                  </div>
                )}
              </form.Field>

              <form.Field name="max_members">
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor="max_members">Max Members</Label>
                    <Input
                      id="max_members"
                      type="number"
                      min={1}
                      placeholder="Unlimited"
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                      disabled={readOnly}
                    />
                    <p className="text-sm text-muted-foreground">
                      Leave empty for unlimited
                    </p>
                  </div>
                )}
              </form.Field>
            </div>

            <form.Field name="welcome_message">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor="welcome_message">Welcome Message</Label>
                  <Textarea
                    id="welcome_message"
                    placeholder="Welcome to the group!"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    disabled={readOnly}
                  />
                  <p className="text-sm text-muted-foreground">
                    Message shown to members when they join
                  </p>
                </div>
              )}
            </form.Field>

            <form.Field name="is_ambassador_group">
              {(field) => (
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <Label htmlFor="is_ambassador_group">
                      Ambassador Group
                    </Label>
                    <p className="text-sm text-muted-foreground">
                      Mark as an ambassador/affiliate group
                    </p>
                  </div>
                  <Switch
                    id="is_ambassador_group"
                    checked={field.state.value}
                    onCheckedChange={(val) => field.handleChange(val)}
                    disabled={readOnly}
                  />
                </div>
              )}
            </form.Field>

            <div className="flex gap-4 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: "/groups" })}
              >
                {readOnly ? "Back" : "Cancel"}
              </Button>
              {!readOnly && (
                <LoadingButton type="submit" loading={isPending}>
                  {isEdit ? "Save Changes" : "Create Group"}
                </LoadingButton>
              )}
            </div>
          </form>
        </CardContent>
      </Card>

      {isEdit && !readOnly && (
        <DangerZone
          description="Once you delete this group, all member associations will be removed. This action cannot be undone."
          onDelete={() => deleteMutation.mutate()}
          isDeleting={deleteMutation.isPending}
          confirmText="Delete Group"
          resourceName={defaultValues.name}
        />
      )}
    </div>
  )
}
