import { useForm } from "@tanstack/react-form"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"

import {
  FormFieldsService,
  SalesFlowsService,
  TicketingStepsService,
} from "@/client"
import { FieldError } from "@/components/Common/FieldError"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

interface NewSalesFlowFormProps {
  popupId: string
}

const EMPTY = "__empty__"

function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

/**
 * Creating a flow asks three things (sdd/sales-flows-rediseno slice 7).
 * Everything else is configured afterwards, in its own section, because
 * nobody knows their abandoned-cart cadence before the flow exists.
 *
 * "Start from" is how a flow gets a checkout and a form without inheriting
 * either: copying is a one-time event, and the two flows are independent
 * from that moment on.
 */
export function NewSalesFlowForm({ popupId }: NewSalesFlowFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const { data: flowsData } = useQuery({
    queryKey: ["sales-flows", popupId],
    queryFn: () => SalesFlowsService.listSalesFlows({ popupId, limit: 100 }),
  })
  const flows = flowsData?.results ?? []
  const defaultFlow = flows.find((f) => f.is_default)

  const createMutation = useMutation({
    mutationFn: async (values: {
      name: string
      type: "application" | "direct" | "upsale"
      sourceFlowId: string
    }) => {
      const created = await SalesFlowsService.createSalesFlow({
        requestBody: {
          popup_id: popupId,
          name: values.name,
          slug: slugify(values.name),
          type: values.type,
        },
      })

      if (values.sourceFlowId !== EMPTY) {
        // Steps and form are copied separately because they are separate
        // resources; a failure in either must not leave the flow uncreated.
        await TicketingStepsService.copyStepsToFlow({
          targetFlowId: created.id,
          requestBody: { source_flow_id: values.sourceFlowId },
        })
        await FormFieldsService.copyFormToFlow({
          targetFlowId: created.id,
          requestBody: { source_flow_id: values.sourceFlowId },
        })
      }

      return created
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["sales-flows"] })
      showSuccessToast("Sales flow created")
      // Straight to its settings: creation is deliberately minimal, so the
      // next thing anyone wants is the rest of the configuration.
      navigate({ to: "/sales-flows/$id/edit", params: { id: created.id } })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const form = useForm({
    defaultValues: {
      name: "",
      type: "application" as "application" | "direct" | "upsale",
      sourceFlowId: defaultFlow?.id ?? EMPTY,
    },
    onSubmit: async ({ value }) => {
      createMutation.mutate(value)
    },
  })

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
      className="mx-auto flex max-w-lg flex-col gap-5"
    >
      <form.Field
        name="name"
        validators={{
          onBlur: ({ value }) => (!value ? "Name is required" : undefined),
        }}
      >
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="flow-name">Name</Label>
            <Input
              id="flow-name"
              value={field.state.value}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              placeholder="Volunteers"
            />
            <FieldError errors={field.state.meta.errors} />
          </div>
        )}
      </form.Field>

      <form.Field name="type">
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="flow-type">Type</Label>
            <Select
              value={field.state.value}
              onValueChange={(v) =>
                field.handleChange(v as typeof field.state.value)
              }
            >
              <SelectTrigger id="flow-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="application">
                  Application — form, review, approval
                </SelectItem>
                <SelectItem value="direct">
                  Direct — anonymous checkout
                </SelectItem>
                <SelectItem value="upsale">
                  Upsale — existing attendees only
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
      </form.Field>

      <form.Field name="sourceFlowId">
        {(field) => (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="flow-source">Start from</Label>
            <Select
              value={field.state.value}
              onValueChange={(v) => field.handleChange(v)}
            >
              <SelectTrigger id="flow-source">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={EMPTY}>An empty flow</SelectItem>
                {flows.map((flow) => (
                  <SelectItem key={flow.id} value={flow.id}>
                    A copy of {flow.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              A copy duplicates the checkout steps and the form once. The two
              flows stay independent afterwards.
            </p>
          </div>
        )}
      </form.Field>

      <div className="flex justify-end gap-2 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => navigate({ to: "/sales-flows" })}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? "Creating..." : "Create flow"}
        </Button>
      </div>

      <p className="border-t pt-3 text-xs text-muted-foreground">
        You can change everything else after the flow exists.
      </p>
    </form>
  )
}
