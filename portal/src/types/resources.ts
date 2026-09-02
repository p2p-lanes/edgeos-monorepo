import type { LucideIcon } from "lucide-react"
import type { ComponentType, SVGProps } from "react"

type ResourceStatus = "soon" | "active" | "inactive" | "disabled" | "hidden"
export type ResourceGroup =
  | "general"
  | "participation"
  | "commerce"
  | "community"

export interface Resource {
  name: string
  icon?: LucideIcon | ComponentType<SVGProps<SVGSVGElement>>
  status: ResourceStatus
  path?: string
  children?: Resource[]
  value?: string | number | React.ReactNode
  group?: ResourceGroup
}
