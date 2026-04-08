import {
  CheckCircle,
  CheckSquare,
  Heart,
  Home,
  HomeIcon,
  Images,
  type LucideIcon,
  Shield,
  ShoppingBag,
  Ticket,
  Youtube,
} from "lucide-react"

export interface StepTypeDefinition {
  step_type: string
  defaultTitle: string
  icon: LucideIcon
}

export interface TemplateDefinition {
  key: string
  label: string
  description: string
  icon: LucideIcon
}

export const TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  {
    key: "ticket-select",
    label: "Ticket Select",
    description: "Checkbox list with price and dates",
    icon: CheckSquare,
  },
  {
    key: "patron-preset",
    label: "Patron Presets",
    description: "Preset amounts + custom input",
    icon: Heart,
  },
  {
    key: "housing-date",
    label: "Housing",
    description: "Property cards with date range",
    icon: HomeIcon,
  },
  {
    key: "merch-image",
    label: "Merch Cards",
    description: "Image cards with quantity",
    icon: ShoppingBag,
  },
  {
    key: "youtube-video",
    label: "YouTube Video",
    description: "Embedded YouTube video",
    icon: Youtube,
  },
  {
    key: "image-gallery",
    label: "Image Gallery",
    description: "Configurable image gallery",
    icon: Images,
  },
]

/** Templates that don't display products and therefore don't need a product category. */
export const CONTENT_ONLY_TEMPLATES = new Set([
  "youtube-video",
  "image-gallery",
])

export const STEP_TYPE_DEFINITIONS: StepTypeDefinition[] = [
  { step_type: "tickets", defaultTitle: "Tickets", icon: Ticket },
  { step_type: "housing", defaultTitle: "Housing", icon: Home },
  { step_type: "merch", defaultTitle: "Merchandise", icon: ShoppingBag },
  { step_type: "patron", defaultTitle: "Patron", icon: Heart },
  { step_type: "insurance_checkout", defaultTitle: "Insurance", icon: Shield },
  { step_type: "confirm", defaultTitle: "Review & Confirm", icon: CheckCircle },
]

export function getStepTypeDefinition(
  stepType: string,
): StepTypeDefinition | undefined {
  return STEP_TYPE_DEFINITIONS.find((d) => d.step_type === stepType)
}
