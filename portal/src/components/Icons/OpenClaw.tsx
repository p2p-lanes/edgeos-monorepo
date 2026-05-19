import type { SVGProps } from "react"
import { cn } from "@/lib/utils"

export const OpenClaw = ({ className, ...props }: SVGProps<SVGSVGElement>) => (
  <svg
    aria-hidden="true"
    viewBox="0 0 120 120"
    fill="none"
    stroke="currentColor"
    strokeWidth="6"
    strokeLinecap="round"
    strokeLinejoin="round"
    xmlns="http://www.w3.org/2000/svg"
    className={cn(className, "size-5")}
    {...props}
  >
    <path d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z" />
    <path d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z" />
    <path d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z" />
    <path d="M45 15 Q35 5 30 8" strokeWidth="4" />
    <path d="M75 15 Q85 5 90 8" strokeWidth="4" />
    <circle cx="45" cy="38" r="5" fill="currentColor" stroke="none" />
    <circle cx="75" cy="38" r="5" fill="currentColor" stroke="none" />
  </svg>
)
