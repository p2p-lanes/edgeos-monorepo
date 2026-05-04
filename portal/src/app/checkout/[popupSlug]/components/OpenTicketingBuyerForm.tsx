"use client"

import {
  Input,
  InputForm,
  LabelRequired,
  SelectForm,
} from "@edgeos/shared-form-ui"
import { useTranslation } from "react-i18next"
import { DynamicField } from "@/app/portal/[popupSlug]/application/components/fields/dynamic-field"
import type { ApplicationFormSchema } from "@/types/form-schema"
import { getCheckoutSchemaSections } from "../../types"

interface OpenTicketingBuyerFormProps {
  schema: ApplicationFormSchema
  values: Record<string, unknown>
  errors: Record<string, string>
  onChange: (fieldName: string, value: unknown) => void
}

function getDisplayGender(
  values: Record<string, unknown>,
  schema: ApplicationFormSchema,
) {
  const gender = values.gender
  if (gender === "Specify") return "Specify"
  if (typeof gender !== "string") return ""

  const options = schema.base_fields.gender?.options ?? []
  if (gender && !options.includes(gender)) return "Specify"
  return gender
}

function getGenderSpecifyValue(values: Record<string, unknown>) {
  const specifiedGender = values.gender_specify
  if (typeof specifiedGender === "string" && specifiedGender) {
    return specifiedGender
  }

  const gender = values.gender
  if (typeof gender !== "string") return ""
  if (gender.startsWith("SYO - ")) return gender.slice("SYO - ".length)
  return ""
}

export function OpenTicketingBuyerForm({
  schema,
  values,
  errors,
  onChange,
}: OpenTicketingBuyerFormProps) {
  const { t } = useTranslation()
  const sections = getCheckoutSchemaSections(schema)
  const genderField = schema.base_fields.gender
  const displayGender = getDisplayGender(values, schema)
  const genderSpecifyValue = getGenderSpecifyValue(values)

  return (
    <section className="space-y-6 rounded-2xl border bg-card p-6 shadow-sm">
      <div>
        <h2 className="text-xl font-semibold">{t("checkout.express_title")}</h2>
        <p className="text-sm text-muted-foreground">
          {t("checkout.express_description", {
            defaultValue: "Complete your information to continue to checkout.",
          })}
        </p>
      </div>

      {sections.map((section) => (
        <section key={section.id} className="space-y-4">
          <div>
            <h3 className="text-base font-semibold">{section.title}</h3>
            {section.subtitle ? (
              <p className="text-sm text-muted-foreground">
                {section.subtitle}
              </p>
            ) : null}
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {section.fields.map(({ name, field }) => {
              if (name === "email") {
                return (
                  <div key={name} className="space-y-2 md:col-span-2">
                    <LabelRequired isRequired={field.required}>
                      {field.label}
                    </LabelRequired>
                    {field.help_text ? (
                      <p className="text-sm text-muted-foreground">
                        {field.help_text}
                      </p>
                    ) : null}
                    <Input
                      id="checkout-email"
                      type="email"
                      value={String(values.email ?? "")}
                      onChange={(event) =>
                        onChange("email", event.target.value)
                      }
                      className="w-full"
                    />
                    {errors.email ? (
                      <p className="text-sm text-destructive">{errors.email}</p>
                    ) : null}
                  </div>
                )
              }

              if (name === "gender" && genderField) {
                return (
                  <div key={name} className="space-y-4 md:col-span-2">
                    <SelectForm
                      label={genderField.label}
                      id="gender"
                      value={displayGender}
                      onChange={(value) => onChange("gender", value)}
                      error={errors.gender}
                      isRequired={genderField.required}
                      options={(genderField.options ?? []).map((option) => ({
                        value: option,
                        label: option,
                      }))}
                    />

                    {displayGender === "Specify" ? (
                      <InputForm
                        label={t("form.gender_specify")}
                        id="gender_specify"
                        value={genderSpecifyValue}
                        onChange={(value) => onChange("gender_specify", value)}
                        error={errors.gender_specify}
                        isRequired
                        placeholder={t("form.gender_specify_placeholder")}
                      />
                    ) : null}
                  </div>
                )
              }

              return (
                <div
                  key={name}
                  className={
                    field.type === "textarea" || field.type === "multiselect"
                      ? "md:col-span-2"
                      : ""
                  }
                >
                  <DynamicField
                    name={name}
                    field={field}
                    value={values[name]}
                    error={errors[name]}
                    onChange={onChange}
                  />
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </section>
  )
}
