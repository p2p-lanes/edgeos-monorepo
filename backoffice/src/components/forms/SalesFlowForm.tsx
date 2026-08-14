import { useForm } from "@tanstack/react-form"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import {
  Hash,
  ListOrdered,
  ShieldCheck,
  Tag,
  User,
  Workflow,
} from "lucide-react"
import { useState } from "react"

import {
  type ApiError,
  type PopupAdmin,
  type SalesFlowCreate,
  type SalesFlowPublic,
  SalesFlowsService,
  type SalesFlowUpdate,
} from "@/client"
import { DangerZone } from "@/components/Common/DangerZone"
import { FieldError } from "@/components/Common/FieldError"
import {
  type ConfigFieldKind,
  ConfigFieldRow,
} from "@/components/forms/ConfigFieldRow"
import { RestrictionRuleEditor } from "@/components/forms/RestrictionRuleEditor"
import { SalesFlowVisibilityNote } from "@/components/forms/SalesFlowVisibilityNote"
import { Button } from "@/components/ui/button"
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
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import {
  UnsavedChangesDialog,
  useUnsavedChanges,
} from "@/hooks/useUnsavedChanges"
import {
  draftsToRestrictionRule,
  parseRestrictionRuleToDrafts,
} from "@/lib/salesFlowRestrictionRule"
import { createErrorHandler } from "@/utils"

interface ConfigFieldConfig {
  key: keyof SalesFlowCreate & keyof PopupAdmin
  label: string
  description?: string
  kind: ConfigFieldKind
  options?: { value: string; label: string }[]
  /**
   * Only shown on flows of this type. Absent means every flow.
   *
   * A direct sale never produces an application, so a scholarship toggle or
   * an abandoned-application cadence there is configuration that can never
   * run — the same reason the API refuses an approval strategy on one.
   */
  appliesTo?: "application"
}

const CONFIG_SECTIONS: {
  title: string
  description?: string
  fields: ConfigFieldConfig[]
}[] = [
  {
    title: "Application Settings",
    fields: [
      {
        key: "application_layout",
        appliesTo: "application",
        label: "Application Layout",
        description:
          "Whether applicants answer the whole form on one page or step through it.",
        kind: "select",
        options: [
          { value: "single_page", label: "Single Page" },
          { value: "multi_step", label: "Multi Step" },
        ],
      },
      {
        key: "requires_application_fee",
        appliesTo: "application",
        label: "Requires Application Fee",
        description: "Charge applicants before their application is reviewed.",
        kind: "boolean",
      },
      {
        key: "application_fee_amount",
        appliesTo: "application",
        label: "Application Fee Amount",
        description: "What that fee costs.",
        kind: "currency",
      },
      {
        key: "allows_scholarship",
        appliesTo: "application",
        label: "Allows Scholarship",
        description:
          "Let applicants ask for a reduced price as part of applying.",
        kind: "boolean",
      },
      {
        key: "allows_incentive",
        label: "Allows Incentive",
        description: "Let applicants be offered a discount on acceptance.",
        kind: "boolean",
        appliesTo: "application",
      },
    ],
  },
  {
    // Coupons are redeemed at checkout, so they apply to any flow that
    // sells. Sitting under "Application Settings" made the heading survive
    // on flows that have no applications at all.
    title: "Discounts",
    fields: [
      {
        key: "allows_coupons",
        label: "Allows Coupons",
        description:
          "Let buyers redeem a discount code at this flow's checkout.",
        kind: "boolean",
      },
    ],
  },
  {
    title: "Checkout Fees",
    description:
      "Extra charged on top of the order at this flow's checkout. Leave both off to sell at face value.",
    fields: [
      {
        key: "insurance_enabled",
        label: "Offer Insurance",
        description:
          "Let buyers add insurance to eligible products during checkout. Opt-in: nobody is charged unless they tick it.",
        kind: "boolean",
      },
      {
        key: "insurance_percentage",
        label: "Insurance Rate (%)",
        description:
          "Percentage of the eligible products' price charged as the insurance fee.",
        kind: "number",
      },
      {
        key: "contribution_enabled",
        label: "Add Contribution",
        description:
          "Add a contribution to every order through this flow. Not opt-in: buyers pay it, so say what it funds below.",
        kind: "boolean",
      },
      {
        key: "contribution_percentage",
        label: "Contribution Rate (%)",
        description:
          "Percentage of the order total, taken before insurance so the two never compound.",
        kind: "number",
      },
      {
        key: "contribution_label",
        label: "Contribution Label",
        description: "The line item's name in the checkout summary.",
        kind: "text",
      },
      {
        key: "contribution_description",
        label: "Contribution Description",
        description:
          "Shown under that line, where the buyer decides whether the charge is fair.",
        kind: "text",
      },
    ],
  },
  {
    title: "Installment Plans",
    description:
      "Let buyers of this flow split an order into scheduled payments. SimpleFi renders the per-cycle selector at checkout.",
    fields: [
      {
        key: "installments_enabled",
        label: "Offer Installments",
        description:
          "Off means one payment. Turning it on needs both a ceiling and a deadline below.",
        kind: "boolean",
      },
      {
        key: "installments_max",
        label: "Max Installments",
        description:
          "The most a buyer may choose. SimpleFi accepts 2 to 12; the buyer picks the actual number at checkout.",
        kind: "number",
      },
      {
        key: "installments_deadline",
        label: "Deadline",
        description:
          "Every installment has to be paid by this date. It caps the ceiling above: a plan that would run past it is shortened, and plans started after it fall back to one payment.",
        kind: "date",
      },
      {
        key: "installments_interval",
        label: "Billing Interval",
        description: "How far apart the payments fall.",
        kind: "select",
        options: [
          { value: "day", label: "Day" },
          { value: "week", label: "Week" },
          { value: "month", label: "Month" },
          { value: "year", label: "Year" },
        ],
      },
      {
        key: "installments_interval_count",
        label: "Interval Count",
        description:
          "Multiplier on the interval — week x 2 bills fortnightly. Empty bills every interval.",
        kind: "number",
      },
    ],
  },
  {
    title: "Open Checkout Redirects",
    description:
      "Where a buyer lands after paying through this flow. Leave empty to keep them on the portal thank-you page.",
    fields: [
      {
        key: "open_checkout_success_url",
        label: "Success URL",
        description:
          "Your own page, shown after a successful payment. Write {locale} anywhere in it to have the buyer's language substituted in.",
        kind: "text",
      },
      {
        key: "open_checkout_cancel_url",
        label: "Cancel URL",
        description:
          "Where a buyer goes after cancelling. Defaults to the portal checkout page.",
        kind: "text",
      },
      {
        key: "open_checkout_signing_secret",
        label: "Signing Secret",
        description:
          "Shared secret used to sign the order data sent to the success URL. Set the same value on that page so it can verify the order is really yours. Empty means the redirect carries no signed payload.",
        kind: "secret",
      },
    ],
  },
  // Nine numbers under one "Reminder Cadence" heading said nothing about
  // which email each one paced. Split into the three emails the popup form
  // already names, each carrying the sentence that explains who receives it.
  {
    title: "Ways In",
    fields: [
      {
        key: "invites_enabled",
        label: "Accept Invites",
        description:
          "Let admins create invite links that land people in this flow. An invite already names the flow it opens, so this is that flow's answer.",
        kind: "boolean",
      },
      {
        key: "referrals_enabled",
        label: "Let Attendees Share",
        description:
          "Let people who came in this way create a link of their own. They share the door they entered by, so it is this flow they bring others into.",
        kind: "boolean",
      },
      {
        key: "max_referrals_per_attendee",
        label: "Uses Per Shared Link",
        description:
          "How many people one attendee's link may bring in. Empty means no limit.",
        kind: "number",
      },
    ],
  },
  {
    title: "Check-in Pass",
    description:
      "Emails ticket holders their check-in QR before the event starts. The wording is this flow's; so is the timing.",
    fields: [
      {
        key: "checkin_pass_lead_days",
        label: "Days before the event",
        description:
          "How far ahead of the start date to send. Empty sends nothing.",
        kind: "number",
      },
    ],
  },
  {
    title: "Abandoned Cart",
    description:
      "Emails buyers who did not complete their purchase. Leave the delay empty to send nothing.",
    fields: [
      {
        key: "abandoned_cart_delay_days",
        label: "Delay (days)",
        description: "How long after they left before the first email.",
        kind: "number",
      },
      {
        key: "abandoned_cart_repeat_days",
        label: "Every (days)",
        description: "How often to follow up. Empty sends once.",
        kind: "number",
      },
      {
        key: "abandoned_cart_max_count",
        label: "Max sends",
        description: "Stop after this many emails.",
        kind: "number",
      },
    ],
  },
  {
    title: "Purchase Reminder",
    description:
      "Emails accepted applicants who have not bought a pass yet. Leave the delay empty to send nothing.",
    fields: [
      {
        key: "purchase_reminder_delay_days",
        label: "Delay (days)",
        description: "How long after acceptance before the first email.",
        kind: "number",
      },
      {
        key: "purchase_reminder_repeat_days",
        label: "Every (days)",
        description: "How often to follow up. Empty sends once.",
        kind: "number",
      },
      {
        key: "purchase_reminder_max_count",
        label: "Max sends",
        description: "Stop after this many emails.",
        kind: "number",
      },
    ],
  },
  {
    title: "Abandoned Application",
    description:
      "Emails applicants whose application is still a draft, counted from their last edit. Leave the delay empty to send nothing.",
    fields: [
      {
        key: "abandoned_application_delay_days",
        appliesTo: "application",
        label: "Delay (days)",
        description: "How long after their last edit before the first email.",
        kind: "number",
      },
      {
        key: "abandoned_application_repeat_days",
        appliesTo: "application",
        label: "Every (days)",
        description: "How often to follow up. Empty sends once.",
        kind: "number",
      },
      {
        key: "abandoned_application_max_count",
        appliesTo: "application",
        label: "Max sends",
        description: "Stop after this many emails.",
        kind: "number",
      },
    ],
  },
]

const CONFIG_FIELDS = CONFIG_SECTIONS.flatMap((section) => section.fields)

function rawToInput(
  kind: ConfigFieldKind,
  raw: string | number | boolean | null | undefined,
): string {
  if (raw === null || raw === undefined) {
    return kind === "boolean" ? "false" : ""
  }
  if (kind === "boolean") return String(Boolean(raw))
  return String(raw)
}

function parseDraftValue(
  kind: ConfigFieldKind,
  draft: string,
): string | number | boolean | null {
  if (kind === "boolean") return draft === "true"
  if (draft === "") return null
  if (kind === "number" || kind === "currency") return Number(draft)
  return draft
}

/**
 * The flow's own values. There is no inherited value to fall back to since
 * sdd/sales-flows-rediseno slice 7 — creating a flow copies the popup's
 * configuration into it, so what the form shows is what the flow stores.
 *
 * A secret starts empty no matter what is stored. Loading it would put the
 * value in the DOM for anyone who opens the page or its devtools, and an
 * operator never needs to read a secret back to replace it. Empty means
 * "leave it as it is" on save, which is what `configPayload` relies on.
 */
function buildInitialConfig(
  defaultValues?: SalesFlowPublic,
): Record<string, string> {
  return Object.fromEntries(
    CONFIG_FIELDS.map((field) => [
      field.key,
      field.kind === "secret"
        ? ""
        : rawToInput(
            field.kind,
            defaultValues?.[field.key as keyof SalesFlowPublic] as never,
          ),
    ]),
  )
}

interface SalesFlowFormProps {
  popupId: string
  defaultValues?: SalesFlowPublic
  onSuccess: () => void
}

/**
 * Pydantic model-level validators (assert_restriction_rule_allowed_for_type)
 * report `loc = ["body"]`, not a `restriction_rule`-scoped path, so the
 * only reliable signal is the message text itself — every restriction_rule
 * validation error, structural or type-guard, starts with that field name.
 */
function extractRestrictionRuleError(err: ApiError): string | undefined {
  const detail = (
    err.body as { detail?: string | Array<{ msg: string }> } | undefined
  )?.detail
  const messages = Array.isArray(detail)
    ? detail.map((d) => d.msg)
    : typeof detail === "string"
      ? [detail]
      : []
  return messages.find((msg) => msg.includes("restriction_rule"))
}

export function SalesFlowForm({
  popupId,
  defaultValues,
  onSuccess,
}: SalesFlowFormProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { isOperatorOrAbove } = useAuth()
  const isEdit = !!defaultValues
  const readOnly = !isOperatorOrAbove
  const [restrictionRuleError, setRestrictionRuleError] = useState<string>()

  const handleMutationError = (err: ApiError) => {
    setRestrictionRuleError(extractRestrictionRuleError(err))
    createErrorHandler(showErrorToast)(err)
  }

  const createMutation = useMutation({
    mutationFn: (data: SalesFlowCreate) =>
      SalesFlowsService.createSalesFlow({ requestBody: data }),
    onSuccess: (data) => {
      showSuccessToast("Sales flow created successfully", {
        label: "View",
        onClick: () =>
          navigate({ to: "/sales-flows/$id/edit", params: { id: data.id } }),
      })
      queryClient.invalidateQueries({ queryKey: ["sales-flows"] })
      form.reset()
      onSuccess()
    },
    onError: handleMutationError,
  })

  const updateMutation = useMutation({
    mutationFn: (data: SalesFlowUpdate) =>
      SalesFlowsService.updateSalesFlow({
        flowId: defaultValues!.id,
        requestBody: data,
      }),
    onSuccess: () => {
      showSuccessToast("Sales flow updated successfully")
      queryClient.invalidateQueries({ queryKey: ["sales-flows"] })
      form.reset()
      onSuccess()
    },
    onError: handleMutationError,
  })

  const deleteMutation = useMutation({
    mutationFn: () =>
      SalesFlowsService.deleteSalesFlow({ flowId: defaultValues!.id }),
    onSuccess: () => {
      showSuccessToast("Sales flow deleted successfully")
      queryClient.invalidateQueries({ queryKey: ["sales-flows"] })
      navigate({ to: "/sales-flows" })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const form = useForm({
    defaultValues: {
      slug: defaultValues?.slug ?? "",
      name: defaultValues?.name ?? "",
      type: defaultValues?.type ?? "application",
      visibility: defaultValues?.visibility ?? "portal_listed",
      is_default: defaultValues?.is_default ?? false,
      order: defaultValues?.order?.toString() ?? "0",
      reviewers_mode: defaultValues?.reviewers_mode ?? "inherit",
      identity_mode: defaultValues?.identity_mode ?? "portal_auth",
      config: buildInitialConfig(defaultValues),
      restrictionRule: parseRestrictionRuleToDrafts(
        defaultValues?.restriction_rule ?? null,
      ),
    },
    onSubmit: ({ value }) => {
      if (readOnly) return
      setRestrictionRuleError(undefined)
      const configPayload = Object.fromEntries(
        CONFIG_FIELDS.filter(
          // An untouched secret field is empty, and empty must not clear a
          // stored secret — omitting the key leaves it as it is.
          (field) => field.kind !== "secret" || value.config[field.key] !== "",
        ).map((field) => [
          field.key,
          parseDraftValue(field.kind, value.config[field.key]),
        ]),
      )
      const basePayload = {
        slug: value.slug,
        name: value.name,
        type: value.type,
        visibility: value.visibility,
        is_default: value.is_default,
        order: Number(value.order),
        reviewers_mode: value.reviewers_mode,
        identity_mode: value.identity_mode,
        restriction_rule: value.restrictionRule.unsupported
          ? defaultValues?.restriction_rule
          : draftsToRestrictionRule(
              value.restrictionRule.combinator,
              value.restrictionRule.leaves,
            ),
        ...configPayload,
      }
      if (isEdit) {
        updateMutation.mutate(basePayload)
      } else {
        if (!value.slug || !value.name) {
          showErrorToast("Please fill in slug and name")
          return
        }
        createMutation.mutate({ popup_id: popupId, ...basePayload })
      }
    },
  })

  const blocker = useUnsavedChanges(form)
  const isPending = createMutation.isPending || updateMutation.isPending

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
        <div className="space-y-3">
          <form.Field
            name="name"
            validators={{
              onBlur: ({ value }) =>
                !readOnly && !value ? "Name is required" : undefined,
            }}
          >
            {(field) => (
              <div>
                <HeroInput
                  placeholder="FLOW NAME"
                  value={field.state.value}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                  disabled={readOnly}
                />
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>
        </div>

        <Separator />

        <InlineSection title="Identity">
          <form.Field
            name="slug"
            validators={{
              onBlur: ({ value }) =>
                !readOnly && !value ? "Slug is required" : undefined,
            }}
          >
            {(field) => (
              <div>
                <InlineRow
                  icon={<Tag className="h-4 w-4 text-muted-foreground" />}
                  label="Slug"
                  description="Used in the checkout URL for this flow"
                >
                  <Input
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                    disabled={readOnly}
                    className="w-48 text-sm"
                  />
                </InlineRow>
                <FieldError errors={field.state.meta.errors} />
              </div>
            )}
          </form.Field>

          <form.Field name="type">
            {(field) => (
              <InlineRow
                icon={<Workflow className="h-4 w-4 text-muted-foreground" />}
                label="Type"
              >
                <Select
                  value={field.state.value}
                  onValueChange={(value) =>
                    field.handleChange(value as typeof field.state.value)
                  }
                  disabled={readOnly}
                >
                  <SelectTrigger className="w-40 text-sm" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="application">Application</SelectItem>
                    <SelectItem value="direct">Direct</SelectItem>
                    <SelectItem value="upsale">Upsale</SelectItem>
                  </SelectContent>
                </Select>
              </InlineRow>
            )}
          </form.Field>

          <form.Field name="visibility">
            {(field) => (
              <InlineRow
                icon={<ListOrdered className="h-4 w-4 text-muted-foreground" />}
                label="Visibility"
                description="Direct-URL-only flows are hidden from the portal listing but still reachable by URL"
              >
                <Select
                  value={field.state.value}
                  onValueChange={(value) =>
                    field.handleChange(value as typeof field.state.value)
                  }
                  disabled={readOnly}
                >
                  <SelectTrigger className="w-48 text-sm" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="portal_listed">Portal Listed</SelectItem>
                    <SelectItem value="direct_url_only">
                      Direct URL Only
                    </SelectItem>
                  </SelectContent>
                </Select>
              </InlineRow>
            )}
          </form.Field>

          <form.Subscribe
            selector={(state) => ({
              type: state.values.type,
              visibility: state.values.visibility,
            })}
          >
            {({ type, visibility }) => (
              <SalesFlowVisibilityNote type={type} visibility={visibility} />
            )}
          </form.Subscribe>

          <form.Field name="order">
            {(field) => (
              <InlineRow
                icon={<Hash className="h-4 w-4 text-muted-foreground" />}
                label="Order"
                description="Lower numbers appear first in the portal listing"
              >
                <Input
                  type="number"
                  value={field.state.value}
                  onChange={(e) => field.handleChange(e.target.value)}
                  disabled={readOnly}
                  className="w-24 text-sm"
                />
              </InlineRow>
            )}
          </form.Field>

          <form.Field name="is_default">
            {(field) => (
              <InlineRow
                icon={<ShieldCheck className="h-4 w-4 text-muted-foreground" />}
                label="Default Flow"
                description="The default flow is used when no flow slug is given in the URL"
              >
                <Switch
                  checked={field.state.value}
                  onCheckedChange={(val) => field.handleChange(val)}
                  disabled={readOnly}
                />
              </InlineRow>
            )}
          </form.Field>

          <form.Field name="reviewers_mode">
            {(field) => (
              <InlineRow
                icon={<User className="h-4 w-4 text-muted-foreground" />}
                label="Reviewers"
                description="Override replaces the event's reviewer list with a flow-specific one"
              >
                <Select
                  value={field.state.value}
                  onValueChange={(value) =>
                    field.handleChange(value as typeof field.state.value)
                  }
                  disabled={readOnly}
                >
                  <SelectTrigger className="w-40 text-sm" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">Inherit from event</SelectItem>
                    <SelectItem value="override">Override</SelectItem>
                  </SelectContent>
                </Select>
              </InlineRow>
            )}
          </form.Field>
        </InlineSection>

        <Separator />

        <InlineSection title="Restriction Rule">
          <p className="px-1 text-xs text-muted-foreground">
            Gate purchases from this flow behind buyer conditions. No conditions
            means every eligible buyer can purchase.
          </p>
          <form.Field name="restrictionRule">
            {(field) => (
              <RestrictionRuleEditor
                combinator={field.state.value.combinator}
                leaves={field.state.value.leaves}
                unsupported={field.state.value.unsupported}
                onChange={(combinator, leaves) =>
                  field.handleChange({
                    combinator,
                    leaves,
                    unsupported: field.state.value.unsupported,
                  })
                }
                readOnly={readOnly}
                error={restrictionRuleError}
              />
            )}
          </form.Field>
        </InlineSection>

        {/*
          Sections follow the type chosen in this form, not the saved one, so
          picking "direct" hides the application settings straight away
          instead of after a save. A section whose every field is filtered
          out is not rendered — an empty heading reads as a missing feature.
        */}
        <form.Subscribe selector={(state) => state.values.type}>
          {(flowType) =>
            CONFIG_SECTIONS.map((section) => {
              const fields = section.fields.filter(
                (f) => !f.appliesTo || f.appliesTo === flowType,
              )
              if (fields.length === 0) return null
              return (
                <div key={section.title}>
                  <Separator />
                  <InlineSection
                    title={section.title}
                    description={section.description}
                  >
                    {fields.map((fieldConfig) => (
                      <form.Field
                        key={fieldConfig.key}
                        name={`config.${fieldConfig.key}` as "config"}
                      >
                        {(field) => (
                          <ConfigFieldRow
                            fieldKey={fieldConfig.key}
                            label={fieldConfig.label}
                            description={fieldConfig.description}
                            kind={fieldConfig.kind}
                            options={fieldConfig.options}
                            value={field.state.value as unknown as string}
                            onValueChange={(value) =>
                              field.handleChange(value as never)
                            }
                            readOnly={readOnly}
                            isConfigured={Boolean(
                              defaultValues?.[
                                fieldConfig.key as keyof SalesFlowPublic
                              ],
                            )}
                          />
                        )}
                      </form.Field>
                    ))}
                  </InlineSection>
                </div>
              )
            })
          }
        </form.Subscribe>

        <Separator />

        <div className="flex gap-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => navigate({ to: "/sales-flows" })}
          >
            {readOnly ? "Back" : "Cancel"}
          </Button>
          {!readOnly && (
            <LoadingButton type="submit" loading={isPending}>
              {isEdit ? "Save Changes" : "Create Sales Flow"}
            </LoadingButton>
          )}
        </div>
      </form>

      {isEdit && !readOnly && (
        <div className="mx-auto max-w-2xl">
          <DangerZone
            description="Once you delete this sales flow, it will be permanently removed. The default flow of a popup cannot be deleted."
            onDelete={() => deleteMutation.mutate()}
            isDeleting={deleteMutation.isPending}
            confirmText="Delete Sales Flow"
            resourceName={defaultValues.name}
            variant="inline"
          />
        </div>
      )}
      <UnsavedChangesDialog blocker={blocker} />
    </div>
  )
}
