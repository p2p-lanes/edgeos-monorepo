import {
  Input,
  InputForm,
  LabelRequired,
  SelectForm,
} from "@edgeos/shared-form-ui"
import { useTranslation } from "react-i18next"
import { DynamicField } from "@/app/portal/[popupSlug]/application/components/fields/dynamic-field"
import type { ApplicationFormSchema } from "@/types/form-schema"
import {
  type CheckoutApplicationValues,
  type DefaultCheckoutFormData,
  getCheckoutSchemaSections,
  toDefaultCheckoutFormData,
} from "../../types"

interface PersonalInfoFormProps {
  formData: CheckoutApplicationValues
  handleInputChange: (field: string, value: unknown) => void
  handleChangeEmail?: () => void
  errors: Record<string, string>
  schema?: ApplicationFormSchema
}

function getDisplayGender(
  formData: CheckoutApplicationValues,
  schema?: ApplicationFormSchema,
) {
  const gender = formData.gender
  if (gender === "Specify") return "Specify"
  if (typeof gender !== "string") return ""

  const options = schema?.base_fields.gender?.options ?? []
  if (gender && !options.includes(gender)) return "Specify"
  return gender
}

function getGenderSpecifyValue(formData: CheckoutApplicationValues) {
  const specifiedGender = formData.gender_specify
  if (typeof specifiedGender === "string" && specifiedGender) {
    return specifiedGender
  }

  const gender = formData.gender
  if (typeof gender !== "string") return ""
  if (gender.startsWith("SYO - ")) return gender.slice("SYO - ".length)
  return ""
}

function shouldRenderSectionHeader(
  sectionId: string,
  title: string,
  index: number,
) {
  const normalizedTitle = title.trim().toLowerCase()
  if (sectionId === "_unsectioned_base" && index === 0) return false
  if (
    normalizedTitle === "personal information" ||
    normalizedTitle === "personal info"
  ) {
    return false
  }

  return true
}

const PersonalInfoForm = ({
  formData,
  handleInputChange,
  handleChangeEmail,
  errors,
  schema,
}: PersonalInfoFormProps) => {
  const { t } = useTranslation()

  if (!schema) {
    const defaultFormData: DefaultCheckoutFormData =
      toDefaultCheckoutFormData(formData)

    return (
      <div className="space-y-4 animate-in fade-in duration-500">
        <div className="w-full flex items-center justify-between gap-4">
          <div className="w-full flex flex-col gap-2">
            <LabelRequired isRequired={false}>
              {t("common.email")}
            </LabelRequired>
            <Input
              id="email-verified"
              type="email"
              value={defaultFormData.email}
              onChange={() => {}}
              disabled
              className="w-full"
            />
          </div>

          {handleChangeEmail && (
            <button
              type="button"
              className="mt-[21px] text-sm underline"
              onClick={handleChangeEmail}
            >
              {t("form.change_email")}
            </button>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <InputForm
            label={t("form.first_name")}
            id="first_name"
            value={defaultFormData.first_name}
            onChange={(value) => handleInputChange("first_name", value)}
            error={errors.first_name}
            isRequired
            placeholder={t("form.first_name_placeholder")}
          />

          <InputForm
            label={t("form.last_name")}
            id="last_name"
            value={defaultFormData.last_name}
            onChange={(value) => handleInputChange("last_name", value)}
            error={errors.last_name}
            isRequired
            placeholder={t("form.last_name_placeholder")}
          />
        </div>

        <InputForm
          label={t("form.telegram")}
          id="telegram"
          value={defaultFormData.telegram}
          onChange={(value) => handleInputChange("telegram", value)}
          error={errors.telegram}
          isRequired
          placeholder={t("form.telegram_placeholder")}
        />

        <InputForm
          label={t("form.gender")}
          id="gender"
          value={defaultFormData.gender}
          onChange={(value) => handleInputChange("gender", value)}
          error={errors.gender}
          isRequired
          placeholder={t("form.gender")}
        />
      </div>
    )
  }

  const sections = getCheckoutSchemaSections(schema)
  const genderField = schema.base_fields.gender
  const displayGender = getDisplayGender(formData, schema)
  const genderSpecifyValue = getGenderSpecifyValue(formData)

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {sections.map((section, index) => (
        <section key={section.id} className="space-y-4">
          {shouldRenderSectionHeader(section.id, section.title, index) && (
            <div>
              <h3 className="text-base font-semibold">{section.title}</h3>
              {section.subtitle && (
                <p className="text-sm text-muted-foreground">
                  {section.subtitle}
                </p>
              )}
            </div>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            {section.fields.map(({ name, field }) => {
              if (name === "email") {
                return (
                  <div key={name} className="space-y-2 md:col-span-2">
                    <div className="flex items-end justify-between gap-4">
                      <div className="flex-1 space-y-2">
                        <LabelRequired isRequired={field.required}>
                          {field.label}
                        </LabelRequired>
                        {field.help_text && (
                          <p className="text-sm text-muted-foreground">
                            {field.help_text}
                          </p>
                        )}
                        <Input
                          id="checkout-email"
                          type="email"
                          value={String(formData.email ?? "")}
                          onChange={() => {}}
                          disabled
                          className="w-full"
                        />
                      </div>

                      {handleChangeEmail && (
                        <button
                          type="button"
                          className="text-sm underline"
                          onClick={handleChangeEmail}
                        >
                          {t("form.change_email")}
                        </button>
                      )}
                    </div>
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
                      onChange={(value) => handleInputChange("gender", value)}
                      error={errors.gender}
                      isRequired={genderField.required}
                      options={(genderField.options ?? []).map((option) => ({
                        value: option,
                        label: option,
                      }))}
                    />

                    {displayGender === "Specify" && (
                      <InputForm
                        label={t("form.gender_specify")}
                        id="gender_specify"
                        value={genderSpecifyValue}
                        onChange={(value) =>
                          handleInputChange("gender_specify", value)
                        }
                        error={errors.gender_specify}
                        isRequired
                        placeholder={t("form.gender_specify_placeholder")}
                      />
                    )}
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
                    value={formData[name]}
                    error={errors[name]}
                    onChange={handleInputChange}
                  />
                </div>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

export default PersonalInfoForm
