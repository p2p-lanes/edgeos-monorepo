/**
 * The questions this checkout asks about the people staying.
 *
 * Mirrors `backend/app/api/accommodation/guest_form.py`: the same field
 * types, the same two sections, the same guests mode. What the backend
 * refuses on write, this refuses to build, so an operator does not discover
 * a bad form by way of a 422.
 *
 * A field's `key` is the slug the answer is stored under. It is generated
 * from the label once, at creation, and then frozen: renaming a question
 * later must not orphan the answers already collected under the old key.
 */

import type { FormFieldSchema } from "@edgeos/shared-form-ui"
import { FIELD_TYPES, slugify } from "@/components/form-builder"

/** The subset of field types a guest form may use.
 *
 * Kept in step with `GUEST_FORM_FIELD_TYPES` on the backend. What is missing
 * is missing on purpose: signature and image upload need an upload target
 * this path does not have, and the card pickers are merchandising controls
 * rather than questions.
 */
export const GUEST_FIELD_TYPES = FIELD_TYPES.filter((type) =>
  [
    "text",
    "textarea",
    "number",
    "boolean",
    "select",
    "radio",
    "multiselect",
    "date",
    "email",
    "url",
    "phone",
    "country_select",
    "rich_text",
  ].includes(type.value),
)

/** Types whose answer is picked from `options`, so the field needs some. */
export const CHOICE_TYPES = new Set(["select", "radio", "multiselect"])

/** Matches `MAX_FIELDS_PER_SECTION` on the backend. */
export const MAX_FIELDS = 30

/** Past this, the editor says so. Not a limit, a nudge: a checkout that asks
 *  ten questions per guest does not get filled in. */
export const CROWDED_AFTER = 6

export type GuestsMode = "same_as_booker" | "custom" | "off"

export interface GuestField {
  key: string
  type: string
  label: string
  required: boolean
  placeholder?: string | null
  help_text?: string | null
  options: string[]
  width?: "full" | "half" | "half_row" | null
  config: Record<string, unknown>
}

export interface GuestFormValue {
  version: number
  booker: {
    title?: string | null
    description?: string | null
    fields: GuestField[]
  }
  guests: {
    mode: GuestsMode
    title?: string | null
    description?: string | null
    fields: GuestField[]
  }
}

export function emptyForm(): GuestFormValue {
  return {
    version: 1,
    booker: { title: null, description: null, fields: [] },
    guests: {
      mode: "same_as_booker",
      title: null,
      description: null,
      fields: [],
    },
  }
}

function parseField(raw: unknown): GuestField | null {
  if (!raw || typeof raw !== "object") return null
  const field = raw as Record<string, unknown>
  if (typeof field.key !== "string" || !field.key) return null
  return {
    key: field.key,
    type: typeof field.type === "string" ? field.type : "text",
    label: typeof field.label === "string" ? field.label : field.key,
    required: field.required === true,
    placeholder:
      typeof field.placeholder === "string" ? field.placeholder : null,
    help_text: typeof field.help_text === "string" ? field.help_text : null,
    options: Array.isArray(field.options)
      ? field.options.filter(
          (option): option is string => typeof option === "string",
        )
      : [],
    width: (field.width as GuestField["width"]) ?? null,
    config:
      field.config && typeof field.config === "object"
        ? (field.config as Record<string, unknown>)
        : {},
  }
}

/** Read a stored form. Forgiving, like the backend's reader: a shape that no
 *  longer makes sense should leave the editor empty, not blank the screen. */
export function parseForm(raw: unknown): GuestFormValue {
  if (!raw || typeof raw !== "object") return emptyForm()
  const form = raw as Record<string, unknown>
  const booker = (form.booker ?? {}) as Record<string, unknown>
  const guests = (form.guests ?? {}) as Record<string, unknown>
  const mode = guests.mode
  return {
    version: typeof form.version === "number" ? form.version : 1,
    booker: {
      title: (booker.title as string) ?? null,
      description: (booker.description as string) ?? null,
      fields: (Array.isArray(booker.fields) ? booker.fields : [])
        .map(parseField)
        .filter((field): field is GuestField => field !== null),
    },
    guests: {
      mode:
        mode === "custom" || mode === "off" || mode === "same_as_booker"
          ? mode
          : "same_as_booker",
      title: (guests.title as string) ?? null,
      description: (guests.description as string) ?? null,
      fields: (Array.isArray(guests.fields) ? guests.fields : [])
        .map(parseField)
        .filter((field): field is GuestField => field !== null),
    },
  }
}

/** The fields each additional guest is asked, `mode` resolved. */
export function guestFieldsOf(form: GuestFormValue): GuestField[] {
  if (form.guests.mode === "off") return []
  if (form.guests.mode === "same_as_booker") return form.booker.fields
  return form.guests.fields
}

/** A form that asks nothing is no form: it is stored as null, so the
 *  checkout asks nothing rather than rendering an empty panel. */
export function isEmpty(form: GuestFormValue | null | undefined): boolean {
  if (!form) return true
  return form.booker.fields.length === 0 && guestFieldsOf(form).length === 0
}

/** The form as `template_config.guest_form` holds it.
 *
 * Untyped on the wire, because `template_config` is a plain JSON column and
 * the generated client has no shape for what lives inside it. The backend
 * validates it on write, which is where a bad form should be caught. */
export function toApi(
  form: GuestFormValue | null | undefined,
): GuestFormValue | null {
  return isEmpty(form) || !form ? null : form
}

/** A key nothing else in this form is using.
 *
 * Falls back to the type when the label slugifies to nothing (a label of
 * "?" or of non-latin script), because a field with no key cannot store an
 * answer at all.
 */
export function makeKey(label: string, type: string, taken: string[]): string {
  const base = slugify(label) || slugify(type) || "field"
  if (!taken.includes(base)) return base
  let suffix = 2
  while (taken.includes(`${base}_${suffix}`)) suffix += 1
  return `${base}_${suffix}`
}

export function makeField(
  type: string,
  label: string,
  taken: string[],
): GuestField {
  return {
    key: makeKey(label, type, taken),
    type,
    label,
    required: false,
    placeholder: null,
    help_text: null,
    options: CHOICE_TYPES.has(type) ? ["Option 1", "Option 2"] : [],
    width: null,
    config: {},
  }
}

/** Every key the form already uses, both sections, so a new one is unique
 *  across the whole thing and copying a field between sections stays safe. */
export function takenKeys(form: GuestFormValue): string[] {
  return [...form.booker.fields, ...form.guests.fields].map(
    (field) => field.key,
  )
}

/** What a field is missing before it can be saved. Mirrors the backend's
 *  write validation, so nothing reaches the API only to bounce. */
export function fieldProblem(field: GuestField): string | null {
  if (!field.label.trim()) return "This question needs a label"
  if (CHOICE_TYPES.has(field.type) && field.options.length === 0) {
    return "Add at least one option to pick from"
  }
  return null
}

export function formProblem(form: GuestFormValue): string | null {
  for (const field of [...form.booker.fields, ...form.guests.fields]) {
    const problem = fieldProblem(field)
    if (problem) return `${field.label || "A question"}: ${problem}`
  }
  if (form.booker.fields.length > MAX_FIELDS) {
    return `The lead guest section can hold at most ${MAX_FIELDS} questions`
  }
  if (form.guests.fields.length > MAX_FIELDS) {
    return `The guests section can hold at most ${MAX_FIELDS} questions`
  }
  return null
}

/** The shape `SchemaField` renders, so the preview is the real control and
 *  not a drawing of one. */
export function toSchemaField(field: GuestField): FormFieldSchema {
  return {
    type: field.type as FormFieldSchema["type"],
    label: field.label,
    required: field.required,
    options: field.options.length ? field.options : undefined,
    placeholder: field.placeholder ?? undefined,
    help_text: field.help_text ?? undefined,
    width: field.width ?? null,
    config: field.config,
  }
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

function build(
  fields: Array<[string, string, boolean]>,
  guests: GuestsMode = "same_as_booker",
): GuestFormValue {
  const form = emptyForm()
  form.guests.mode = guests
  for (const [type, label, required] of fields) {
    const field = makeField(type, label, takenKeys(form))
    field.required = required
    form.booker.fields.push(field)
  }
  return form
}

export interface GuestFormPreset {
  key: string
  label: string
  description: string
  build: () => GuestFormValue
}

/** Starting points, because a blank editor is the slowest way to begin.
 *
 * Every preset asks the *lead guest* the questions and repeats them for the
 * others; narrowing that is one click in the guests section.
 */
export const PRESETS: GuestFormPreset[] = [
  {
    key: "contact",
    label: "Contact details",
    description: "Email and phone, so the property can reach whoever arrives",
    build: () =>
      build([
        ["email", "Email", true],
        ["phone", "Phone", false],
      ]),
  },
  {
    key: "registry",
    label: "Hotel registry",
    description: "What a front desk is usually required to record",
    build: () =>
      build([
        ["email", "Email", true],
        ["phone", "Phone", true],
        ["date", "Date of birth", true],
        ["country_select", "Nationality", true],
        ["text", "ID or passport number", true],
      ]),
  },
  {
    key: "lead_only",
    label: "Lead guest only",
    description: "One set of contact details per room, nothing per guest",
    build: () => build([["email", "Email", true]], "off"),
  },
  {
    key: "blank",
    label: "Start from scratch",
    description: "An empty form to add your own questions to",
    build: emptyForm,
  },
]
