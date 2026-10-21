import { Check, Circle, Minus } from "lucide-react"
import type { ApplicationPublic } from "@/client"

export function ApplicationStatusStepper({
  application,
}: {
  application: ApplicationPublic
}) {
  const status = application.status

  const steps = [
    {
      label: "Submitted",
      date: application.submitted_at,
      completed:
        status === "in review" ||
        status === "accepted" ||
        status === "rejected" ||
        (status === "withdrawn" && Boolean(application.submitted_at)),
      active: status === "draft" || status === "in review",
    },
    {
      label: "In Review",
      date: null,
      completed:
        status === "accepted" ||
        status === "rejected" ||
        (status === "withdrawn" && Boolean(application.accepted_at)),
      active: status === "in review",
    },
    {
      label:
        status === "withdrawn"
          ? "Withdrawn"
          : status === "rejected"
            ? "Rejected"
            : "Accepted",
      date: status === "withdrawn" ? null : application.accepted_at,
      completed:
        status === "accepted" ||
        status === "rejected" ||
        status === "withdrawn",
      active: false,
    },
  ]

  return (
    <div className="flex items-center justify-between gap-2">
      {steps.map((step, idx) => (
        <div
          key={step.label}
          className="flex items-center flex-1 last:flex-none"
        >
          <div className="flex flex-col items-center gap-1">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full border-2 ${
                status === "withdrawn" && idx === steps.length - 1
                  ? "border-muted-foreground bg-muted text-muted-foreground"
                  : step.completed
                    ? status === "rejected" && idx === steps.length - 1
                      ? "border-destructive bg-destructive text-destructive-foreground"
                      : "border-primary bg-primary text-primary-foreground"
                    : step.active
                      ? "border-primary text-primary"
                      : "border-muted-foreground/30 text-muted-foreground/30"
              }`}
            >
              {status === "withdrawn" && idx === steps.length - 1 ? (
                <Minus className="h-4 w-4" />
              ) : step.completed ? (
                <Check className="h-4 w-4" />
              ) : (
                <Circle className="h-3 w-3" />
              )}
            </div>
            <span
              className={`text-xs font-medium ${
                step.completed || step.active
                  ? "text-foreground"
                  : "text-muted-foreground/50"
              }`}
            >
              {step.label}
            </span>
            {step.date && (
              <span className="text-[10px] text-muted-foreground">
                {new Date(step.date).toLocaleDateString()}
              </span>
            )}
          </div>
          {idx < steps.length - 1 && (
            <div
              className={`h-0.5 flex-1 mx-2 mt-[-20px] ${
                steps[idx + 1].completed || steps[idx + 1].active
                  ? "bg-primary"
                  : "bg-muted-foreground/20"
              }`}
            />
          )}
        </div>
      ))}
    </div>
  )
}
