/**
 * @deprecated CSV product import was a one-off experiment. The dialog is no
 * longer mounted from the Products page, and the backend `/products/batch`
 * endpoint is marked deprecated. Don't add new callers.
 */

import type { ProductBatchItem, ProductBatchResult } from "@/client"
import type { CsvColumnConfig } from "@/components/Common/CsvImportDialog"

const VALID_CATEGORIES = ["ticket", "housing", "merch", "other", "patreon"]
const VALID_ATTENDEE_CATEGORIES = ["main", "spouse", "kid"]
const VALID_DURATION_TYPES = ["day", "week", "month", "full"]

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

const validateSaleDate = (v: string): string | null =>
  !v || DATE_ONLY_RE.test(v) ? null : "Must be in YYYY-MM-DD format"

const passThrough = (v: string): string | undefined => v || undefined

export const productCsvColumns: CsvColumnConfig<ProductBatchItem>[] = [
  {
    header: "Name",
    key: "name",
    required: true,
  },
  {
    header: "Price",
    key: "price",
    required: true,
    validate: (v) => {
      const n = Number(v)
      if (Number.isNaN(n)) return "Must be a number"
      if (n < 0) return "Must be >= 0"
      return null
    },
    parse: (v) => (v ? Number(v) : 0),
  },
  {
    header: "Category",
    key: "category",
    validate: (v) => {
      if (!v) return null
      const lower = v.toLowerCase()
      return VALID_CATEGORIES.includes(lower)
        ? null
        : `Must be one of: ${VALID_CATEGORIES.join(", ")}`
    },
    parse: (v) => (v ? v.toLowerCase() : undefined),
  },
  {
    header: "Description",
    key: "description",
    parse: (v) => v || undefined,
  },
  {
    header: "Attendee Category",
    key: "attendee_category",
    validate: (v) => {
      if (!v) return null
      const lower = v.toLowerCase()
      return VALID_ATTENDEE_CATEGORIES.includes(lower)
        ? null
        : `Must be one of: ${VALID_ATTENDEE_CATEGORIES.join(", ")}`
    },
    parse: (v) => (v ? v.toLowerCase() : undefined),
  },
  {
    header: "Duration Type",
    key: "duration_type",
    validate: (v) => {
      if (!v) return null
      const lower = v.toLowerCase()
      return VALID_DURATION_TYPES.includes(lower)
        ? null
        : `Must be one of: ${VALID_DURATION_TYPES.join(", ")}`
    },
    parse: (v) => (v ? v.toLowerCase() : undefined),
  },
  {
    header: "Sale Starts At",
    key: "sale_starts_at",
    validate: validateSaleDate,
    parse: passThrough,
  },
  {
    header: "Sale Ends At",
    key: "sale_ends_at",
    validate: validateSaleDate,
    parse: passThrough,
  },
  {
    header: "Exclusive",
    key: "exclusive",
    validate: (v) => {
      if (!v) return null
      const lower = v.toLowerCase()
      return ["true", "false", "1", "0", "yes", "no"].includes(lower)
        ? null
        : "Must be true/false, yes/no, or 1/0"
    },
    parse: (v) => {
      if (!v) return false
      return ["true", "1", "yes"].includes(v.toLowerCase())
    },
  },
  {
    header: "Is Active",
    key: "is_active",
    validate: (v) => {
      if (!v) return null
      const lower = v.toLowerCase()
      return ["true", "false", "1", "0", "yes", "no"].includes(lower)
        ? null
        : "Must be true/false, yes/no, or 1/0"
    },
    parse: (v) => {
      if (!v) return true
      return ["true", "1", "yes"].includes(v.toLowerCase())
    },
  },
  {
    header: "Total Stock",
    key: "total_stock_cap",
    validate: (v) => {
      if (!v) return null
      const n = Number(v)
      if (!Number.isInteger(n)) return "Must be a whole number"
      if (n < 1) return "Must be >= 1"
      return null
    },
    parse: (v) => (v ? Number(v) : undefined),
  },
  {
    header: "Max Per Order",
    key: "max_per_order",
    validate: (v) => {
      if (!v) return null
      const n = Number(v)
      if (!Number.isInteger(n)) return "Must be a whole number"
      if (n < 1) return "Must be >= 1"
      return null
    },
    parse: (v) => (v ? Number(v) : undefined),
  },
] satisfies CsvColumnConfig<ProductBatchItem>[]

export type { ProductBatchResult }
