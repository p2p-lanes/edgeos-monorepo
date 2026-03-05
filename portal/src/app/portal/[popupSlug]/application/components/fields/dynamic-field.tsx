import CheckboxForm from "@/components/ui/Form/Checkbox"
import InputForm from "@/components/ui/Form/Input"
import SelectForm from "@/components/ui/Form/Select"
import TextAreaForm from "@/components/ui/Form/TextArea"
import { FormInputWrapper } from "@/components/ui/form-input-wrapper"
import { LabelRequired } from "@/components/ui/label"
import { MultiSelect } from "@/components/ui/MultiSelect"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { cn } from "@/lib/utils"
import type { FormFieldSchema } from "@/types/form-schema"

interface DynamicFieldProps {
  name: string
  field: FormFieldSchema
  value: unknown
  error?: string
  onChange: (name: string, value: unknown) => void
  hideLabelAndSubtitle?: boolean
}

function mapOptions(options?: string[]) {
  return (options ?? []).map((opt) => ({ value: opt, label: opt }))
}

export function DynamicField({
  name,
  field,
  value,
  error,
  onChange,
  hideLabelAndSubtitle = false,
}: DynamicFieldProps) {
  const displayLabel = hideLabelAndSubtitle ? "" : field.label
  const displayHelpText = hideLabelAndSubtitle ? undefined : field.help_text

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
          onChange={(v) => onChange(name, v)}
          error={error}
          isRequired={field.required}
          subtitle={displayHelpText}
          placeholder={field.placeholder}
        />
      )

    case "textarea":
      return (
        <TextAreaForm
          label={displayLabel}
          id={name}
          value={(value as string) ?? ""}
          handleChange={(v) => onChange(name, v)}
          error={error ?? ""}
          isRequired={field.required}
          subtitle={displayHelpText}
          placeholder={field.placeholder}
        />
      )

    case "number":
      return (
        <InputForm
          label={displayLabel}
          id={name}
          type="number"
          value={(value as string) ?? ""}
          onChange={(v) => onChange(name, v)}
          error={error}
          isRequired={field.required}
          subtitle={displayHelpText}
          placeholder={field.placeholder}
        />
      )

    case "date":
      return (
        <InputForm
          label={displayLabel}
          id={name}
          type="date"
          value={(value as string) ?? ""}
          onChange={(v) => onChange(name, v)}
          error={error}
          isRequired={field.required}
          subtitle={displayHelpText}
        />
      )

    case "boolean":
      return (
        <CheckboxForm
          title={displayLabel}
          label={displayHelpText}
          id={name}
          checked={(value as boolean) ?? false}
          onCheckedChange={(v) => onChange(name, v)}
          required={field.required}
          error={error}
        />
      )

    case "select":
      return (
        <SelectForm
          label={displayLabel}
          id={name}
          value={(value as string) ?? ""}
          onChange={(v) => onChange(name, v)}
          options={mapOptions(field.options)}
          error={error}
          isRequired={field.required}
          placeholder={field.placeholder ?? "Select an option"}
        />
      )

    case "select_cards": {
      const options = field.options ?? []
      const currentValue = (value as string) ?? ""
      const radioGroupId = `${name}-select-cards`
      return (
        <FormInputWrapper>
          <LabelRequired
            isRequired={field.required}
            id={`${radioGroupId}-label`}
          >
            {displayLabel}
          </LabelRequired>
          {displayHelpText && (
            <p className="text-sm text-muted-foreground">{displayHelpText}</p>
          )}
          <RadioGroup
            value={currentValue}
            onValueChange={(v) => onChange(name, v)}
            className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2"
            role="radiogroup"
            aria-labelledby={`${radioGroupId}-label`}
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
                    isSelected ? "border-primary/50 bg-muted" : "border-input",
                  )}
                  htmlFor={optionId}
                >
                  <RadioGroupItem
                    value={option}
                    id={optionId}
                    className="shrink-0"
                    aria-checked={isSelected}
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
          <LabelRequired isRequired={field.required}>
            {displayLabel}
          </LabelRequired>
          {displayHelpText && (
            <p className="text-sm text-muted-foreground">{displayHelpText}</p>
          )}
          <MultiSelect
            options={mapOptions(field.options)}
            onChange={(v) => onChange(name, v)}
            defaultValue={(value as string[]) ?? []}
          />
          {error && <p className="text-red-500 text-sm">{error}</p>}
        </FormInputWrapper>
      )

    default:
      return (
        <InputForm
          label={displayLabel}
          id={name}
          value={(value as string) ?? ""}
          onChange={(v) => onChange(name, v)}
          error={error}
          isRequired={field.required}
          subtitle={displayHelpText}
          placeholder={field.placeholder}
        />
      )
  }
}
