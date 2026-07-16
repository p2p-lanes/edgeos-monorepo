import {
  CheckCircle,
  CheckSquare,
  FileText,
  Heart,
  HelpCircle,
  Home,
  HomeIcon,
  Images,
  LayoutGrid,
  type LucideIcon,
  Shield,
  ShoppingBag,
  Sparkles,
  Ticket,
  User,
  Utensils,
  Video,
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
  /** Pins the step's `step_type` instead of deriving it from the title.
   *  For templates the checkout routes by step_type rather than by template
   *  (the buyer form is rendered by `step_type === "buyer"`, not by its
   *  template), a title-derived type like "your-information" would leave the
   *  step configured and invisible. */
  stepType?: string
}

export const TEMPLATE_DEFINITIONS: TemplateDefinition[] = [
  {
    key: "hero",
    label: "Hero / Home",
    description: "Opening screen: artwork, headline and bullets",
    icon: Sparkles,
  },
  {
    key: "ticket-select",
    label: "Ticket Select",
    description: "Checkbox list with price and dates",
    icon: CheckSquare,
  },
  {
    key: "ticket-card",
    label: "Ticket Cards",
    description: "Section cards with hero image and stepper",
    icon: LayoutGrid,
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
    icon: Video,
  },
  {
    key: "image-gallery",
    label: "Image Gallery",
    description: "Configurable image gallery",
    icon: Images,
  },
  {
    key: "faqs",
    label: "FAQs",
    description: "Expandable list of questions and answers",
    icon: HelpCircle,
  },
  {
    key: "rich-text",
    label: "Rich Text / Banner",
    description: "Sanitized HTML for marketing banners and custom copy",
    icon: FileText,
  },
  {
    key: "meal-plan-select",
    label: "Meal Plan Select",
    description: "Weekly meal plans with per-day dish picker",
    icon: Utensils,
  },
  {
    key: "buyer-form",
    label: "Buyer Form",
    description:
      "Collects the buyer's details before payment. The fields come from the form builder — only the heading is configured here",
    icon: User,
    stepType: "buyer",
  },
]

/** Templates that don't display products and therefore don't need a product category. */
export const CONTENT_ONLY_TEMPLATES = new Set([
  "hero",
  "youtube-video",
  "image-gallery",
  "faqs",
  "rich-text",
  "buyer-form",
])

export const STEP_TYPE_DEFINITIONS: StepTypeDefinition[] = [
  { step_type: "tickets", defaultTitle: "Tickets", icon: Ticket },
  { step_type: "housing", defaultTitle: "Housing", icon: Home },
  { step_type: "merch", defaultTitle: "Merchandise", icon: ShoppingBag },
  { step_type: "patron", defaultTitle: "Patron", icon: Heart },
  { step_type: "meal_plan", defaultTitle: "Meal Plan", icon: Utensils },
  { step_type: "buyer", defaultTitle: "Your information", icon: User },
  { step_type: "insurance_checkout", defaultTitle: "Insurance", icon: Shield },
  { step_type: "confirm", defaultTitle: "Review & Confirm", icon: CheckCircle },
]

export function getStepTypeDefinition(
  stepType: string,
): StepTypeDefinition | undefined {
  return STEP_TYPE_DEFINITIONS.find((d) => d.step_type === stepType)
}
