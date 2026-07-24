/**
 * The subset of PopupForm's `useForm` values this checklist reads. Kept
 * structural (and tolerant of the form's string-typed numeric fields, e.g.
 * `installments_max`) so it decouples from `PopupCreate`, whose numeric fields
 * are typed as `number | null` while the form holds them as strings.
 */
interface PopupFormValues {
  simplefi_api_key?: string | null
  requires_application_fee?: boolean | null
  invoice_company_name?: string | null
  invoice_company_address?: string | null
  invoice_company_email?: string | null
  contribution_enabled?: boolean | null
  contribution_percentage?: string | number | null
  installments_enabled?: boolean | null
  installments_deadline?: string | null
  installments_max?: string | number | null
  installments_interval_count?: string | number | null
}

interface LaunchRequirement {
  label: string // English, user-facing
  appliesWhen?: (v: PopupFormValues) => boolean // omit = always applies
  isSatisfied: (v: PopupFormValues) => boolean
}

const LAUNCH_REQUIREMENTS: LaunchRequirement[] = [
  {
    label: "SimpleFi API key (payment integration)",
    isSatisfied: (v) => !!v.simplefi_api_key?.trim(),
  },

  {
    label: "Invoice company name",
    appliesWhen: (v) => !!v.requires_application_fee,
    isSatisfied: (v) => !!v.invoice_company_name?.trim(),
  },
  {
    label: "Invoice company address",
    appliesWhen: (v) => !!v.requires_application_fee,
    isSatisfied: (v) => !!v.invoice_company_address?.trim(),
  },
  {
    label: "Invoice company email",
    appliesWhen: (v) => !!v.requires_application_fee,
    isSatisfied: (v) => !!v.invoice_company_email?.trim(),
  },

  {
    label: "Contribution rate (%)",
    appliesWhen: (v) => !!v.contribution_enabled,
    isSatisfied: (v) => Number(v.contribution_percentage) > 0,
  },

  {
    label: "Installments deadline",
    appliesWhen: (v) => !!v.installments_enabled,
    isSatisfied: (v) => v.installments_deadline != null,
  },
  {
    label: "Max installments",
    appliesWhen: (v) => !!v.installments_enabled,
    isSatisfied: (v) => Number(v.installments_max) >= 2,
  },
  {
    label: "Installments interval count",
    appliesWhen: (v) => !!v.installments_enabled,
    isSatisfied: (v) => Number(v.installments_interval_count) >= 1,
  },
]

/** Returns the English labels of launch-required fields still missing. Empty = ready. */
export function getMissingLaunchFields(v: PopupFormValues): string[] {
  return LAUNCH_REQUIREMENTS.filter(
    (r) => (!r.appliesWhen || r.appliesWhen(v)) && !r.isSatisfied(v),
  ).map((r) => r.label)
}
