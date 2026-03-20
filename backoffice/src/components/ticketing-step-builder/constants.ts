import {
  Calendar,
  CheckCircle,
  CheckSquare,
  Hash,
  Heart,
  Home,
  LayoutGrid,
  Shield,
  ShoppingBag,
  Ticket,
  type LucideIcon,
} from "lucide-react"

export interface StepTypeDefinition {
  step_type: string
  defaultTitle: string
  icon: LucideIcon
}

export interface DisplayVariantDefinition {
  key: string
  label: string
  description: string
  icon: LucideIcon
}

export const DISPLAY_VARIANT_DEFINITIONS: DisplayVariantDefinition[] = [
  { key: "ticket-select",    label: "Ticket Select",    description: "Checkbox list with price and dates",  icon: CheckSquare },
  { key: "ticket-card",      label: "Ticket Cards",     description: "Full-bleed grid of ticket cards",     icon: LayoutGrid },
  { key: "quantity-spinner", label: "Quantity Spinner", description: "+/- quantity controls per product",   icon: Hash },
  { key: "patron-preset",    label: "Patron Presets",   description: "Preset amounts + custom input",       icon: Heart },
  { key: "housing-date",     label: "Housing + Dates",  description: "Property cards with date range",      icon: Calendar },
  { key: "merch-image",      label: "Merch Cards",      description: "Image cards with quantity",           icon: ShoppingBag },
]

export const STEP_TYPE_DEFINITIONS: StepTypeDefinition[] = [
  { step_type: "tickets",            defaultTitle: "Tickets",          icon: Ticket },
  { step_type: "housing",            defaultTitle: "Housing",          icon: Home },
  { step_type: "merch",              defaultTitle: "Merchandise",      icon: ShoppingBag },
  { step_type: "patron",             defaultTitle: "Patron",           icon: Heart },
  { step_type: "insurance_checkout", defaultTitle: "Insurance",        icon: Shield },
  { step_type: "confirm",            defaultTitle: "Review & Confirm", icon: CheckCircle },
]

export function getStepTypeDefinition(stepType: string): StepTypeDefinition | undefined {
  return STEP_TYPE_DEFINITIONS.find((d) => d.step_type === stepType)
}
