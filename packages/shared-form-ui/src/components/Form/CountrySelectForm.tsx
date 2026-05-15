import { useMemo } from "react"
import { COUNTRIES } from "../../data/countries"
import { SelectForm, type SelectFormProps } from "./SelectForm"

export type CountrySelectFormProps = Omit<SelectFormProps, "options">

export function CountrySelectForm(props: CountrySelectFormProps) {
  const options = useMemo(
    () => COUNTRIES.map((c) => ({ value: c.name, label: c.name })),
    [],
  )
  return (
    <SelectForm
      {...props}
      options={options}
      placeholder={props.placeholder ?? "Select a country"}
    />
  )
}
