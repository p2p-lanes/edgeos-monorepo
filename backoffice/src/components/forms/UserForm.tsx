import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { z } from "zod"

import {
  type UserCreate,
  type UserPublic,
  type UserRole,
  UsersService,
  type UserUpdate,
} from "@/client"
import { DangerZone } from "@/components/Common/DangerZone"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

const emailSchema = z.string().email({ message: "Invalid email address" })
const roleSchema = z.enum(["superadmin", "admin", "viewer"] as const)

const ROLE_OPTIONS: { value: UserRole; label: string; description: string }[] =
  [
    {
      value: "superadmin",
      label: "Superadmin",
      description: "Full platform access",
    },
    { value: "admin", label: "Admin", description: "Full tenant access" },
    { value: "viewer", label: "Viewer", description: "Read-only access" },
  ]

interface UserFormProps {
  defaultValues?: UserPublic
  onSuccess: () => void
}

export function UserForm({ defaultValues, onSuccess }: UserFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { isSuperadmin, user: currentUser } = useAuth()
  const { effectiveTenantId } = useWorkspace()
  const isEdit = !!defaultValues
  const isCurrentUser = currentUser?.id === defaultValues?.id

  // Filter role options based on current user role
  const availableRoles = isSuperadmin
    ? ROLE_OPTIONS
    : ROLE_OPTIONS.filter((r) => r.value !== "superadmin")

  const createMutation = useMutation({
    mutationFn: (data: UserCreate) =>
      UsersService.createUser({ requestBody: data }),
    onSuccess: () => {
      showSuccessToast(
        "User created successfully. They can now log in with their email.",
      )
      queryClient.invalidateQueries({ queryKey: ["users"] })
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
  })

  const updateMutation = useMutation({
    mutationFn: (data: UserUpdate) =>
      UsersService.updateUser({
        userId: defaultValues!.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("User updated successfully")
      queryClient.invalidateQueries({ queryKey: ["users"] })
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: () => UsersService.deleteUser({ userId: defaultValues!.id }),
    onSuccess: () => {
      showSuccessToast("User deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["users"] })
      navigate({ to: "/admin" })
    },
    onError: handleError.bind(showErrorToast),
  })

  const form = useForm({
    defaultValues: {
      email: defaultValues?.email ?? "",
      full_name: defaultValues?.full_name ?? "",
      role: (defaultValues?.role ?? "viewer") as UserRole,
      tenant_id: defaultValues?.tenant_id ?? effectiveTenantId,
    },
    onSubmit: ({ value }) => {
      if (isEdit) {
        updateMutation.mutate({
          full_name: value.full_name || null,
          role: value.role,
        })
      } else {
        const submitData: UserCreate = {
          email: value.email,
          full_name: value.full_name || undefined,
          role: value.role,
          tenant_id: value.role === "superadmin" ? null : value.tenant_id,
        }
        createMutation.mutate(submitData)
      }
    },
  })

  const isPending = createMutation.isPending || updateMutation.isPending

  return (
    <div className="space-y-6">
      {isEdit && (
        <Card>
          <CardHeader>
            <CardTitle>User Information</CardTitle>
            <CardDescription>Details about this user</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-muted-foreground">Email</Label>
              <p className="font-medium">{defaultValues.email}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>{isEdit ? "Edit User" : "User Details"}</CardTitle>
          <CardDescription>
            {isEdit
              ? "Update the user's information and role"
              : "Create a new user. They will receive a login code via email when they sign in."}
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
            {!isEdit && (
              <form.Field
                name="email"
                validators={{
                  onBlur: ({ value }) => {
                    const result = emailSchema.safeParse(value)
                    return result.success
                      ? undefined
                      : result.error.issues[0].message
                  },
                }}
              >
                {(field) => (
                  <div className="space-y-2">
                    <Label htmlFor={field.name}>
                      Email <span className="text-destructive">*</span>
                    </Label>
                    <Input
                      id={field.name}
                      placeholder="user@example.com"
                      type="email"
                      autoComplete="off"
                      spellCheck={false}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-destructive text-sm">
                        {field.state.meta.errors.join(", ")}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>
            )}

            <form.Field name="full_name">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>Full Name</Label>
                  <Input
                    id={field.name}
                    placeholder="John Doe"
                    type="text"
                    autoComplete="off"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                </div>
              )}
            </form.Field>

            <form.Field
              name="role"
              validators={{
                onBlur: ({ value }) => {
                  const result = roleSchema.safeParse(value)
                  return result.success
                    ? undefined
                    : result.error.issues[0].message
                },
              }}
            >
              {(field) => (
                <div className="space-y-2">
                  <Label>
                    Role <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={field.state.value}
                    onValueChange={(val) => field.handleChange(val as UserRole)}
                    disabled={isCurrentUser}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a role" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableRoles.map((role) => (
                        <SelectItem
                          key={role.value}
                          value={role.value}
                          textValue={role.label}
                        >
                          <div className="flex flex-col">
                            <span>{role.label}</span>
                            <span className="text-xs text-muted-foreground">
                              {role.description}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {isCurrentUser && (
                    <p className="text-sm text-muted-foreground">
                      You cannot change your own role
                    </p>
                  )}
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">
                      {field.state.meta.errors.join(", ")}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <div className="flex gap-4 pt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate({ to: "/admin" })}
              >
                Cancel
              </Button>
              <LoadingButton type="submit" loading={isPending}>
                {isEdit ? "Save Changes" : "Create User"}
              </LoadingButton>
            </div>
          </form>
        </CardContent>
      </Card>

      {isEdit && !isCurrentUser && (
        <DangerZone
          description="Once you delete this user, they will no longer be able to access the platform. This action cannot be undone."
          onDelete={() => deleteMutation.mutate()}
          isDeleting={deleteMutation.isPending}
          confirmText="Delete User"
          resourceName={defaultValues.email}
        />
      )}
    </div>
  )
}
