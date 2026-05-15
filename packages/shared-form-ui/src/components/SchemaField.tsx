import type {
  FormFieldSchema,
  ImageUploadConfig,
  MultiSelectDetailedConfig,
  RichTextConfig,
  SignatureConfig,
  SignatureValue,
} from "../types"
import { cn } from "../utils"
import { CheckboxForm } from "./Form/CheckboxForm"
import { CountrySelectForm } from "./Form/CountrySelectForm"
import { ImageUploadForm } from "./Form/ImageUploadForm"
import { InputForm } from "./Form/InputForm"
import { MultiSelectDetailedForm } from "./Form/MultiSelectDetailedForm"
import { PhoneInputForm } from "./Form/PhoneInputForm"
import { RadioListForm } from "./Form/RadioListForm"
import { RichTextForm } from "./Form/RichTextForm"
import { SelectForm } from "./Form/SelectForm"
import { SignatureForm } from "./Form/SignatureForm"
import { TextAreaForm } from "./Form/TextAreaForm"
import { FormInputWrapper } from "./FormInputWrapper"
import { LabelRequired } from "./Label"
import { MultiSelect } from "./MultiSelect"
import { RadioGroup, RadioGroupItem } from "./RadioGroup"

function mapOptions(options?: string[], currentValue?: string) {
  const values = [...(options ?? [])]

  if (currentValue && !values.includes(currentValue)) {
    values.push(currentValue)
  }

  return values.map((opt) => ({ value: opt, label: opt }))
}

export interface SchemaFieldProps {
  name: string
  field: FormFieldSchema
  value: unknown
  error?: string
  onChange: (name: string, value: unknown) => void
  hideLabelAndSubtitle?: boolean
  /** When true, field is read-only (e.g. for form builder preview) */
  readOnly?: boolean
  disabled?: boolean
}

export function SchemaField({
  name,
  field,
  value,
  error,
  onChange,
  hideLabelAndSubtitle = false,
  readOnly = false,
  disabled = false,
}: SchemaFieldProps) {
  const displayLabel = hideLabelAndSubtitle ? "" : field.label
  const displayHelpText = hideLabelAndSubtitle ? undefined : field.help_text
  const showRequiredIndicator = !hideLabelAndSubtitle && field.required
  const isDisabled = disabled || readOnly
  const handleChange = readOnly ? () => {} : onChange

  switch (field.type) {
    case "text":
    case "email":
    case "url":
      return (
        <InputForm
          label={displayLabel}
          id={name}
          type={
            field.type === "url"
              ? "url"
              : field.type === "email"
                ? "email"
                : "text"
          }
          value={(value as string) ?? ""}
          onChange={(v) => handleChange(name, v)}
          error={error}
          isRequired={showRequiredIndicator}
          subtitle={displayHelpText}
          placeholder={field.placeholder}
          disabled={isDisabled}
          readOnly={readOnly}
        />
      )

    case "textarea":
      return (
        <TextAreaForm
          label={displayLabel}
          id={name}
          value={(value as string) ?? ""}
          handleChange={(v) => handleChange(name, v)}
          error={error ?? ""}
          isRequired={showRequiredIndicator}
          subtitle={displayHelpText}
          placeholder={field.placeholder}
          disabled={isDisabled}
          readOnly={readOnly}
        />
      )

    case "number":
      return (
        <InputForm
          label={displayLabel}
          id={name}
          type="number"
          value={(value as string) ?? ""}
          onChange={(v) => handleChange(name, v)}
          error={error}
          isRequired={showRequiredIndicator}
          subtitle={displayHelpText}
          placeholder={field.placeholder}
          disabled={isDisabled}
          readOnly={readOnly}
        />
      )

    case "date":
      return (
        <InputForm
          label={displayLabel}
          id={name}
          type="date"
          value={(value as string) ?? ""}
          onChange={(v) => handleChange(name, v)}
          error={error}
          isRequired={showRequiredIndicator}
          subtitle={displayHelpText}
          disabled={isDisabled}
          readOnly={readOnly}
          min={field.min_date ?? undefined}
          max={field.max_date ?? undefined}
        />
      )

    case "boolean":
      return (
        <CheckboxForm
          title={displayLabel}
          label={displayHelpText}
          id={name}
          checked={(value as boolean) ?? false}
          onCheckedChange={(v) => handleChange(name, v)}
          required={showRequiredIndicator}
          error={error}
          disabled={isDisabled}
        />
      )

    case "select":
      return (
        <SelectForm
          label={displayLabel}
          id={name}
          value={(value as string) ?? ""}
          onChange={(v) => handleChange(name, v)}
          options={mapOptions(field.options, (value as string) ?? "")}
          error={error}
          isRequired={showRequiredIndicator}
          placeholder={field.placeholder ?? "Select an option"}
          disabled={isDisabled}
        />
      )

    case "select_cards": {
      const options = field.options ?? []
      const currentValue = (value as string) ?? ""
      const radioGroupId = `${name}-select-cards`
      return (
        <FormInputWrapper>
          {(displayLabel || displayHelpText) && (
            <>
              {displayLabel && (
                <LabelRequired
                  isRequired={showRequiredIndicator}
                  id={`${radioGroupId}-label`}
                >
                  {displayLabel}
                </LabelRequired>
              )}
              {displayHelpText && (
                <p className="text-sm text-muted-foreground">
                  {displayHelpText}
                </p>
              )}
            </>
          )}
          <RadioGroup
            value={currentValue}
            onValueChange={(v) => handleChange(name, v)}
            className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2"
            role="radiogroup"
            aria-labelledby={`${radioGroupId}-label`}
            disabled={isDisabled}
          >
            {options.map((option) => {
              const isSelected = currentValue === option
              const optionId = `${name}-${option.replace(/\s+/g, "-")}`
              return (
                <label
                  key={option}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-lg border p-2 transition-colors",
                    "hover:border-muted-foreground/30",
                    isSelected
                      ? "border-primary/50 bg-muted"
                      : "border-input",
                    isDisabled && "cursor-not-allowed opacity-60",
                  )}
                  htmlFor={optionId}
                >
                  <RadioGroupItem
                    value={option}
                    id={optionId}
                    className="shrink-0"
                    aria-checked={isSelected}
                    disabled={isDisabled}
                  />
                  <span className="text-sm font-medium">{option}</span>
                </label>
              )
            })}
          </RadioGroup>
          {error && (
            <p className="mt-1 text-sm text-red-500" role="alert">
              {error}
            </p>
          )}
        </FormInputWrapper>
      )
    }

    case "multiselect":
      return (
        <FormInputWrapper>
          {(displayLabel || displayHelpText) && (
            <>
              {displayLabel && (
                <LabelRequired isRequired={showRequiredIndicator}>
                  {displayLabel}
                </LabelRequired>
              )}
              {displayHelpText && (
                <p className="text-sm text-muted-foreground">
                  {displayHelpText}
                </p>
              )}
            </>
          )}
          <MultiSelect
            options={mapOptions(field.options)}
            onChange={(v) => handleChange(name, v)}
            value={(value as string[]) ?? []}
            disabled={isDisabled}
          />
          {error && (
            <p className="text-red-500 text-sm">{error}</p>
          )}
        </FormInputWrapper>
      )

    case "radio":
      return (
        <RadioListForm
          label={displayLabel}
          id={name}
          value={(value as string) ?? ""}
          onChange={(v) => handleChange(name, v)}
          options={field.options ?? []}
          error={error}
          isRequired={showRequiredIndicator}
          subtitle={displayHelpText}
          disabled={isDisabled}
        />
      )

    case "multiselect_detailed":
      return (
        <MultiSelectDetailedForm
          label={displayLabel}
          id={name}
          value={(value as string[]) ?? []}
          onChange={(v) => handleChange(name, v)}
          options={field.options ?? []}
          config={field.config as MultiSelectDetailedConfig | undefined}
          error={error}
          isRequired={showRequiredIndicator}
          subtitle={displayHelpText}
          placeholder={field.placeholder}
          disabled={isDisabled}
        />
      )

    case "phone":
      return (
        <PhoneInputForm
          label={displayLabel}
          id={name}
          value={(value as string) ?? ""}
          onChange={(v) => handleChange(name, v)}
          error={error}
          isRequired={showRequiredIndicator}
          subtitle={displayHelpText}
          placeholder={field.placeholder}
          disabled={isDisabled}
        />
      )

    case "rich_text":
      return (
        <RichTextForm
          id={name}
          label={displayLabel}
          config={field.config as RichTextConfig | undefined}
          value={value as boolean | undefined}
          onChange={(v) => handleChange(name, v)}
          error={error}
          isRequired={showRequiredIndicator}
          disabled={isDisabled}
        />
      )

    case "image_upload":
      return (
        <ImageUploadForm
          id={name}
          label={displayLabel}
          subtitle={displayHelpText}
          config={field.config as ImageUploadConfig | undefined}
          value={(value as string) ?? ""}
          onChange={(v) => handleChange(name, v)}
          error={error}
          isRequired={showRequiredIndicator}
          disabled={isDisabled}
          readOnly={readOnly}
        />
      )

    case "country_select":
      return (
        <CountrySelectForm
          label={displayLabel}
          id={name}
          value={(value as string) ?? ""}
          onChange={(v) => handleChange(name, v)}
          error={error}
          isRequired={showRequiredIndicator}
          placeholder={field.placeholder}
          disabled={isDisabled}
        />
      )

    case "signature":
      return (
        <SignatureForm
          id={name}
          label={displayLabel}
          subtitle={displayHelpText}
          config={field.config as SignatureConfig | undefined}
          value={(value as SignatureValue | undefined) ?? {}}
          onChange={(v) => handleChange(name, v)}
          error={error}
          isRequired={showRequiredIndicator}
          disabled={isDisabled}
          readOnly={readOnly}
        />
      )

    default:
      return (
        <InputForm
          label={displayLabel}
          id={name}
          value={(value as string) ?? ""}
          onChange={(v) => handleChange(name, v)}
          error={error}
          isRequired={showRequiredIndicator}
          subtitle={displayHelpText}
          placeholder={field.placeholder}
          disabled={isDisabled}
          readOnly={readOnly}
        />
      )
  }
}
