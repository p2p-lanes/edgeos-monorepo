"use client"

import { FileUploadProvider, SchemaField } from "@edgeos/shared-form-ui"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil } from "lucide-react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { useFileUpload } from "@/app/portal/[popupSlug]/events/lib/useFileUpload"
import { PaymentsService } from "@/client"
import { Button } from "@/components/ui/button"
import { buildFormZodSchema } from "@/lib/form-schema-builder"
import { cn } from "@/lib/utils"
import type { FormFieldSchema } from "@/types/form-schema"

export function answerText(value: unknown): string {
  if (
    value === null ||
    value === undefined ||
    value === "" ||
    (Array.isArray(value) && !value.length)
  )
    return "—"
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) return value.map(answerText).join(", ")
  if (typeof value === "object") return JSON.stringify(value)
  return String(value)
}

function initialValue(value: unknown, schema: FormFieldSchema): unknown {
  if (schema.type === "number") return value == null ? "" : String(value)
  if (value != null) return value
  if (schema.type === "boolean" || schema.type === "rich_text") return false
  if (schema.type === "multiselect" || schema.type === "multiselect_detailed")
    return []
  if (schema.type === "signature") return {}
  return ""
}

export function PaymentFormResponses({
  paymentId,
  className,
}: {
  paymentId: string
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const client = useQueryClient()
  const { uploadFile } = useFileUpload()
  const queryKey = ["payment-form-responses", paymentId]
  const query = useQuery({
    queryKey,
    queryFn: () => PaymentsService.getMyFormResponses({ paymentId }),
    retry: false,
  })
  const [open, setOpen] = useState(false)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [now, setNow] = useState(Date.now())
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const data = query.data
  if (!data?.fields.length) return null
  const editable = data.fields.filter((field) => field.editable)
  const canEdit =
    data.can_edit && !!data.deadline && now < Date.parse(data.deadline)
  const date = (value: string) =>
    new Intl.DateTimeFormat(i18n.language, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: data.timezone,
    }).format(new Date(value))
  const startEditing = async () => {
    const fresh = await query.refetch()
    if (fresh.isError || !fresh.data?.can_edit) return
    setAnswers(
      Object.fromEntries(
        fresh.data.fields
          .filter((f) => f.editable)
          .map((f) => [
            String(f.id),
            initialValue(f.value, f.definition as unknown as FormFieldSchema),
          ]),
      ),
    )
    setVersion(fresh.data.version)
    setErrors({})
    setOpen(true)
  }
  const save = async () => {
    const schema = {
      custom_fields: {},
      sections: [],
      base_fields: Object.fromEntries(
        editable.map((f) => [
          String(f.id),
          f.definition as unknown as FormFieldSchema,
        ]),
      ),
    }
    const parsed = buildFormZodSchema(schema, false).safeParse(answers)
    if (!parsed.success) {
      setErrors(
        Object.fromEntries(
          parsed.error.issues.map((issue) => [
            String(issue.path[0]),
            issue.message,
          ]),
        ),
      )
      return
    }
    setSaving(true)
    try {
      const result = await PaymentsService.editMyFormResponses({
        paymentId,
        requestBody: { version, answers },
      })
      client.setQueryData(queryKey, result)
      await client.invalidateQueries({ queryKey: ["payments"] })
      toast.success(t("form_responses.saved"))
      setOpen(false)
    } catch (error: unknown) {
      const body = (error as { body?: { detail?: unknown } }).body
      toast.error(
        typeof body?.detail === "string"
          ? body.detail
          : t("form_responses.save_error"),
      )
      await query.refetch()
    } finally {
      setSaving(false)
    }
  }
  return (
    <section
      className={cn("space-y-3 border-t pt-4", className)}
      aria-label={t("form_responses.title")}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-lg font-semibold">{data.title}</h3>
        {canEdit && !open && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 gap-1.5 px-2 text-muted-foreground hover:text-foreground"
            aria-label={t("form_responses.edit")}
            onClick={startEditing}
          >
            <Pencil className="size-3.5" aria-hidden="true" />
            {t("form_responses.edit_action")}
          </Button>
        )}
      </div>
      {!open && (
        <dl className="grid gap-3 sm:grid-cols-2">
          {data.fields.map((field) => (
            <div key={String(field.id)}>
              <dt className="text-xs text-muted-foreground">
                {String((field.definition as unknown as FormFieldSchema).label)}
              </dt>
              <dd className="mt-1 whitespace-pre-wrap break-words text-sm">
                {field.value == null ||
                field.value === "" ||
                (Array.isArray(field.value) && !field.value.length)
                  ? t("form_responses.not_answered")
                  : answerText(field.value)}
              </dd>
            </div>
          ))}
        </dl>
      )}
      {canEdit && (
        <p className="text-xs text-muted-foreground">
          {t("form_responses.deadline", {
            date: date(data.deadline!),
            timezone: data.timezone,
          })}
        </p>
      )}
      {data.editing_enabled &&
        data.deadline &&
        now >= Date.parse(data.deadline) && (
          <p className="text-xs text-muted-foreground">
            {t("form_responses.expired")}
          </p>
        )}
      {open && (
        <FileUploadProvider value={uploadFile}>
          <form
            aria-label={t("form_responses.edit")}
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault()
              void save()
            }}
          >
            {editable.map((field) => (
              <SchemaField
                key={String(field.id)}
                name={String(field.id)}
                field={field.definition as unknown as FormFieldSchema}
                value={answers[String(field.id)]}
                error={errors[String(field.id)]}
                disabled={saving || !canEdit}
                onChange={(name, value) =>
                  setAnswers((previous) => ({ ...previous, [name]: value }))
                }
              />
            ))}
            {!canEdit && <p role="alert">{t("form_responses.unavailable")}</p>}
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setOpen(false)}
              >
                {t("form_responses.cancel")}
              </Button>
              <Button type="submit" disabled={saving || !canEdit}>
                {saving ? t("form_responses.saving") : t("form_responses.save")}
              </Button>
            </div>
          </form>
        </FileUploadProvider>
      )}
    </section>
  )
}
