// Buyer-form helpers for open checkout: validation over the built Zod schema,
// the `custom_`-prefix handling, and assembly of the `BuyerInfo` the anonymous
// /purchase endpoint expects. The prefix rules mirror the portal's
// usePaymentSubmit exactly.

import type { z } from "zod/v4"
import type { BuyerInfo } from "../types/api"

const CUSTOM_PREFIX = "custom_"

/**
 * Extract the custom-field values for the purchase `form_data`: keep only
 * `custom_`-prefixed entries and strip the prefix so raw field names are sent.
 * Mirrors usePaymentSubmit's `form_data` construction.
 */
export function stripCustomPrefix(
  formData: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(formData).flatMap(([key, value]) =>
      key.startsWith(CUSTOM_PREFIX)
        ? [[key.slice(CUSTOM_PREFIX.length), value]]
        : [],
    ),
  )
}

export interface BuyerValidation {
  valid: boolean
  /** field name → first error message. */
  errors: Record<string, string>
}

/**
 * Validate buyer form values against a built Zod schema. Returns per-field error
 * messages (first issue wins per field).
 */
export function validateBuyerValues(
  schema: z.ZodType,
  values: Record<string, unknown>,
): BuyerValidation {
  const result = schema.safeParse(values)
  if (result.success) return { valid: true, errors: {} }

  const errors: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const key = issue.path.length > 0 ? String(issue.path[0]) : "_"
    if (!(key in errors)) errors[key] = issue.message
  }
  return { valid: false, errors }
}

/** Whether the buyer form passes validation. */
export function isBuyerComplete(
  schema: z.ZodType,
  values: Record<string, unknown>,
): boolean {
  return schema.safeParse(values).success
}

/** The field names that currently fail validation. */
export function invalidFields(
  schema: z.ZodType,
  values: Record<string, unknown>,
): string[] {
  return Object.keys(validateBuyerValues(schema, values).errors)
}

export interface BuyerInput {
  email: string
  firstName: string
  lastName: string
  /** All form values (custom fields still carry the `custom_` prefix). */
  formData: Record<string, unknown>
}

/**
 * Build the `BuyerInfo` body for /purchase. `form_data` carries only the
 * custom-field values with the `custom_` prefix stripped — identical to the
 * portal's open-ticketing purchase.
 */
export function toBuyerInfo(input: BuyerInput): BuyerInfo {
  return {
    email: input.email,
    first_name: input.firstName,
    last_name: input.lastName,
    form_data: stripCustomPrefix(input.formData),
  }
}
