import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query"
import { createFileRoute, Link } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { EllipsisVertical, Eye, Pencil, Plus, Trash2 } from "lucide-react"
import { Suspense, useState } from "react"

import { type FormFieldPublic, FormFieldsService } from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { WorkspaceAlert } from "@/components/Common/WorkspaceAlert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { useWorkspace } from "@/contexts/WorkspaceContext"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { handleError } from "@/utils"

function getFormFieldsQueryOptions(popupId: string | null) {
  return {
    queryFn: () =>
      FormFieldsService.listFormFields({
        skip: 0,
        limit: 100,
        popupId: popupId || undefined,
      }),
    queryKey: ["form-fields", popupId],
  }
}

export const Route = createFileRoute("/_layout/form-builder/")({
  component: FormFields,
  head: () => ({
    meta: [{ title: "Form Builder - EdgeOS" }],
  }),
})

function AddFormFieldButton() {
  return (
    <Button asChild>
      <Link to="/form-builder/new">
        <Plus className="mr-2 h-4 w-4" />
        Add Field
      </Link>
    </Button>
  )
}

// Delete Form Field Dialog
function DeleteFormField({
  field,
  onSuccess,
}: {
  field: FormFieldPublic
  onSuccess: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const mutation = useMutation({
    mutationFn: () => FormFieldsService.deleteFormField({ fieldId: field.id }),
    onSuccess: () => {
      showSuccessToast("Form field deleted successfully")
      setIsOpen(false)
      onSuccess()
    },
    onError: handleError.bind(showErrorToast),
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ["form-fields"] }),
  })

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuItem
        variant="destructive"
        onSelect={(e) => e.preventDefault()}
        onClick={() => setIsOpen(true)}
      >
        <Trash2 className="mr-2 h-4 w-4" />
        Delete
      </DropdownMenuItem>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete Form Field</DialogTitle>
          <DialogDescription>
            Are you sure you want to delete "{field.label}"? Applications may
            lose their stored data for this field. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <LoadingButton
            variant="destructive"
            loading={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            Delete
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Actions Menu
function FormFieldActionsMenu({ field }: { field: FormFieldPublic }) {
  const [open, setOpen] = useState(false)
  const { isAdmin } = useAuth()

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Form field actions">
          <EllipsisVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <Link to="/form-builder/$id/edit" params={{ id: field.id }}>
            {isAdmin ? (
              <>
                <Pencil className="mr-2 h-4 w-4" />
                Edit
              </>
            ) : (
              <>
                <Eye className="mr-2 h-4 w-4" />
                View
              </>
            )}
          </Link>
        </DropdownMenuItem>
        {isAdmin && (
          <DeleteFormField field={field} onSuccess={() => setOpen(false)} />
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const columns: ColumnDef<FormFieldPublic>[] = [
  {
    accessorKey: "label",
    header: "Label",
    cell: ({ row }) => (
      <span className="font-medium">{row.original.label}</span>
    ),
  },
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <span className="font-mono text-sm text-muted-foreground">
        {row.original.name}
      </span>
    ),
  },
  {
    accessorKey: "field_type",
    header: "Type",
    cell: ({ row }) => (
      <Badge variant="outline">{row.original.field_type}</Badge>
    ),
  },
  {
    accessorKey: "section",
    header: "Section",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.section || "—"}
      </span>
    ),
  },
  {
    accessorKey: "required",
    header: "Required",
    cell: ({ row }) =>
      row.original.required ? (
        <Badge variant="default">Required</Badge>
      ) : (
        <Badge variant="secondary">Optional</Badge>
      ),
  },
  {
    accessorKey: "position",
    header: "Position",
    cell: ({ row }) => <span>{row.original.position}</span>,
  },
  {
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row }) => (
      <div className="flex justify-end">
        <FormFieldActionsMenu field={row.original} />
      </div>
    ),
  },
]

function FormFieldsTableContent() {
  const { selectedPopupId } = useWorkspace()
  const { data: formFields } = useSuspenseQuery(
    getFormFieldsQueryOptions(selectedPopupId),
  )
  return <DataTable columns={columns} data={formFields.results} />
}

function FormFields() {
  const { isAdmin } = useAuth()
  const { isContextReady } = useWorkspace()

  return (
    <div className="flex flex-col gap-6">
      {!isContextReady && <WorkspaceAlert resource="form buiilder" />}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Form Builder</h1>
          <p className="text-muted-foreground">
            Configure custom fields for application forms
          </p>
        </div>
        {isAdmin && isContextReady && <AddFormFieldButton />}
      </div>
      {isContextReady && (
        <QueryErrorBoundary>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <FormFieldsTableContent />
          </Suspense>
        </QueryErrorBoundary>
      )}
    </div>
  )
}
