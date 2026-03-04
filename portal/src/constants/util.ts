import i18n from "@/i18n/config"

export const getGenderOptions = () => [
  { value: "Male", label: i18n.t("form.gender_male") },
  { value: "Female", label: i18n.t("form.gender_female") },
  { value: "Specify", label: i18n.t("form.gender_specify_own") },
  { value: "Prefer not to say", label: i18n.t("form.gender_prefer_not") },
]

// Keep static export for backwards compat where t() is available
export const GENDER_OPTIONS = [
  { value: "Male", label: "Male" },
  { value: "Female", label: "Female" },
  { value: "Specify", label: "Specify own gender" },
  { value: "Prefer not to say", label: "Prefer not to say" },
]
