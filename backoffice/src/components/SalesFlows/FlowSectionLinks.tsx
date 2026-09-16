import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import {
  CircleAlert,
  FormInput,
  LayoutList,
  type LucideIcon,
  Mail,
} from "lucide-react"

import { SalesFlowsService } from "@/client"

interface FlowSectionLinksProps {
  popupId: string
  flowId: string
  /** Optional on the API response; anything but "application" hides the form. */
  flowType?: string
}

interface SectionLink {
  to: "/ticketing-steps" | "/form-builder" | "/email-templates"
  icon: LucideIcon
  title: string
  status: string
  blocked: boolean
}

/**
 * Where this flow's things live.
 *
 * The flow edit page used to embed the form, the emails and the reviewers,
 * so the same resource was edited in two places and neither said which flow
 * it meant. They live in their own sections now; this points at them with
 * the flow already selected.
 *
 * Each line shows the state that section is in, read from the same
 * readiness the flow map uses. One definition of "incomplete", not two.
 */
export function FlowSectionLinks({
  popupId,
  flowId,
  flowType,
}: FlowSectionLinksProps) {
  const { data: readiness } = useQuery({
    queryKey: ["sales-flows", "readiness", { popupId }],
    queryFn: () => SalesFlowsService.listSalesFlowReadiness({ popupId }),
    enabled: !!popupId,
  })

  const mine = readiness?.find((r) => r.flow_id === flowId)
  const blockers = mine?.blockers ?? []

  const links: SectionLink[] = [
    {
      to: "/ticketing-steps",
      icon: LayoutList,
      title: "Checkout steps",
      status: mine
        ? `${mine.enabled_step_count} step${
            mine.enabled_step_count === 1 ? "" : "s"
          } · ${mine.offered_product_count} product${
            mine.offered_product_count === 1 ? "" : "s"
          } on sale`
        : "",
      blocked:
        blockers.includes("no_steps") || blockers.includes("sells_nothing"),
    },
  ]

  // Only application flows produce an application, so only they have a form
  // to fill in. Offering the link anywhere else is an invitation to
  // configure something that never runs.
  if (flowType === "application") {
    links.push({
      to: "/form-builder",
      icon: FormInput,
      title: "Application form",
      status: mine
        ? mine.form_field_count === 0
          ? "No questions yet"
          : `${mine.form_field_count} question${
              mine.form_field_count === 1 ? "" : "s"
            }`
        : "",
      blocked: blockers.includes("no_form"),
    })
  }

  links.push({
    to: "/email-templates",
    icon: Mail,
    title: "Sale emails",
    status: "Wording for this flow's sales",
    blocked: false,
  })

  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {links.map((link) => (
        <Link
          key={link.to}
          to={link.to}
          search={{ flow: flowId }}
          className={`flex items-start gap-3 rounded-lg border px-4 py-3 transition-colors ${
            link.blocked
              ? "border-destructive/40 hover:border-destructive/70"
              : "hover:border-primary/50"
          }`}
        >
          <link.icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0">
            <span className="block font-medium text-sm">{link.title}</span>
            <span
              className={`flex items-center gap-1 text-xs ${
                link.blocked ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {link.blocked && <CircleAlert className="h-3 w-3 shrink-0" />}
              {link.status}
            </span>
          </span>
        </Link>
      ))}
    </div>
  )
}
