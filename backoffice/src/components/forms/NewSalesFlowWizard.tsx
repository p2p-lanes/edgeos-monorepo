import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Check, ChevronRight } from "lucide-react"
import { useMemo, useState } from "react"

import {
  FormFieldsService,
  SalesFlowsService,
  type SalesFlowType,
  TicketingStepsService,
} from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import useCustomToast from "@/hooks/useCustomToast"
import {
  notCarriedAcross,
  type StartOption,
  slugifyFlowName,
  startChoicesFor,
  TYPE_COPY,
} from "@/lib/salesFlowStart"
import { cn } from "@/lib/utils"
import { createErrorHandler } from "@/utils"

const TYPES: SalesFlowType[] = ["application", "direct", "upsale"]

/**
 * Opening a way in, one question at a time.
 *
 * The order is the design. Asking what the door does first means a starting
 * point that cannot produce that kind of door is never offered, so inheriting
 * settings the door can never read stops being a mistake anyone can make.
 * Creation used to ask all three at once, which is how somebody could pick a
 * checkout door as the source for a reviewed one.
 *
 * The preview comes from the backend rather than being worked out here. It is
 * computed by the same code that seeds the flow, so the screen cannot promise
 * something creation will not deliver — and for somebody who does not know
 * what these settings do, that promise is the only thing they have to go on.
 */
export function NewSalesFlowWizard({ popupId }: { popupId: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [step, setStep] = useState(1)
  const [flowType, setFlowType] = useState<SalesFlowType | null>(null)
  const [startFrom, setStartFrom] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [showOtherKinds, setShowOtherKinds] = useState(false)

  const { data: flowsData } = useQuery({
    queryKey: ["sales-flows", popupId],
    queryFn: () => SalesFlowsService.listSalesFlows({ popupId, limit: 100 }),
  })
  const flows = useMemo(() => flowsData?.results ?? [], [flowsData])

  const choices = useMemo(
    () => (flowType ? startChoicesFor(flowType, flows) : null),
    [flowType, flows],
  )
  const chosen: StartOption | null = useMemo(() => {
    if (!choices || !startFrom) return null
    return (
      [...choices.offered, ...choices.otherKinds].find(
        (o) => o.id === startFrom,
      ) ?? null
    )
  }, [choices, startFrom])

  const { data: preview } = useQuery({
    queryKey: ["sales-flow-start-preview", popupId, flowType, startFrom],
    queryFn: () =>
      SalesFlowsService.previewSalesFlowStart({
        popupId,
        type: flowType ?? "application",
        startFrom,
      }),
    enabled: step === 3 && !!flowType && !!startFrom,
  })

  const slug = slugifyFlowName(name)

  const createMutation = useMutation({
    mutationFn: async () => {
      const created = await SalesFlowsService.createSalesFlow({
        requestBody: {
          popup_id: popupId,
          name: name.trim(),
          slug,
          type: flowType ?? "application",
          start_from: startFrom,
        },
      })

      // Steps and the buyer form are separate resources, copied separately so
      // a failure in either cannot leave the door uncreated. Only a copy of an
      // existing door has any to take.
      if (chosen?.kind === "copy") {
        await TicketingStepsService.copyStepsToFlow({
          targetFlowId: created.id,
          requestBody: { source_flow_id: chosen.id },
        })
        await FormFieldsService.copyFormToFlow({
          targetFlowId: created.id,
          requestBody: { source_flow_id: chosen.id },
        })
      }

      return created
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ["sales-flows"] })
      showSuccessToast("Sales flow created")
      navigate({ to: "/sales-flows/$id/edit", params: { id: created.id } })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const answers = [
    {
      n: 1,
      label: "What it does",
      answer: flowType && TYPE_COPY[flowType].label,
    },
    { n: 2, label: "Where it starts", answer: chosen?.name ?? null },
    { n: 3, label: "Name it", answer: slug || null },
  ]

  function chooseType(next: SalesFlowType) {
    // A source that can no longer produce this kind of door stops being the
    // answer, rather than waiting to be rejected at submit.
    if (chosen?.kind === "copy" && chosen.sourceType !== next) {
      setStartFrom(null)
    }
    setFlowType(next)
    setShowOtherKinds(false)
    setStep(2)
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-7">
      {/* where we are */}
      <ol className="flex flex-wrap items-center gap-2">
        {answers.map((a, i) => {
          const done = step > a.n
          const now = step === a.n
          return (
            <li key={a.n} className="flex items-center gap-2">
              {i > 0 && <span className="h-px w-4 bg-border" />}
              <button
                type="button"
                disabled={!done}
                onClick={() => setStep(a.n)}
                className={cn(
                  "flex items-center gap-2 rounded-md px-1 py-1 text-sm",
                  now
                    ? "font-semibold text-foreground"
                    : "text-muted-foreground",
                  done && "hover:text-foreground",
                )}
              >
                <span
                  className={cn(
                    "grid h-5 w-5 place-items-center rounded-full border text-[11px]",
                    done && "border-primary bg-primary/10 text-primary",
                    now && "border-primary bg-primary/10 text-primary",
                  )}
                >
                  {done ? <Check className="h-3 w-3" /> : a.n}
                </span>
                {a.label}
                {done && a.answer && (
                  <span className="text-xs text-muted-foreground">
                    {a.answer}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ol>

      {/* ─── 1 · what it does ─────────────────────────────── */}
      {step === 1 && (
        <section className="flex flex-col gap-4">
          <header className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold tracking-tight">
              What does this sales flow do?
            </h2>
            <p className="text-sm text-muted-foreground">
              Everything else follows from this, so it is the only question
              here.
            </p>
          </header>
          <div className="grid gap-3 sm:grid-cols-3">
            {TYPES.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => chooseType(t)}
                className={cn(
                  "flex flex-col gap-1.5 rounded-xl border p-4 text-left transition-colors hover:border-primary",
                  flowType === t && "border-primary bg-primary/5",
                )}
              >
                <span className="font-semibold">{TYPE_COPY[t].label}</span>
                <span className="text-sm text-muted-foreground">
                  {TYPE_COPY[t].description}
                </span>
                <span className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                  {TYPE_COPY[t].aside}
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* ─── 2 · where it starts ──────────────────────────── */}
      {step === 2 && flowType && choices && (
        <section className="flex flex-col gap-4">
          <header className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold tracking-tight">
              Where should it start?
            </h2>
            <p className="text-sm text-muted-foreground">
              You said {TYPE_COPY[flowType].label.toLowerCase()}. Everything
              offered here can be that.
            </p>
          </header>

          <div className="flex flex-col gap-2">
            {choices.offered.map((option) => (
              <StartRow
                key={option.id}
                option={option}
                selected={startFrom === option.id}
                onSelect={() => {
                  setStartFrom(option.id)
                  setStep(3)
                }}
              />
            ))}
          </div>

          {choices.otherKinds.length > 0 && (
            <div className="rounded-xl border border-dashed">
              <button
                type="button"
                onClick={() => setShowOtherKinds((v) => !v)}
                className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm text-muted-foreground hover:text-foreground"
              >
                <ChevronRight
                  className={cn(
                    "h-4 w-4 transition-transform",
                    showOtherKinds && "rotate-90",
                  )}
                />
                Copy a door of a different kind (
                {choices.otherKinds.length === 1
                  ? "1 door"
                  : `${choices.otherKinds.length} doors`}
                )
              </button>
              {showOtherKinds && (
                <div className="flex flex-col gap-3 border-t p-4">
                  <div className="rounded-lg border border-warning/40 bg-warning-soft p-3">
                    <p className="text-sm font-semibold text-warning">
                      These are doors of another kind
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Their settings can still be copied, but not the ones a{" "}
                      {TYPE_COPY[flowType].label.toLowerCase()} door can never
                      use:
                    </p>
                    <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
                      {notCarriedAcross(flowType).map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="flex flex-col gap-2">
                    {choices.otherKinds.map((option) => (
                      <StartRow
                        key={option.id}
                        option={option}
                        selected={startFrom === option.id}
                        onSelect={() => {
                          setStartFrom(option.id)
                          setStep(3)
                        }}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div>
            <Button variant="outline" onClick={() => setStep(1)}>
              Back
            </Button>
          </div>
        </section>
      )}

      {/* ─── 3 · name it ──────────────────────────────────── */}
      {step === 3 && flowType && chosen && (
        <section className="flex flex-col gap-5">
          <header className="flex flex-col gap-1">
            <h2 className="text-xl font-semibold tracking-tight">
              What do people call it?
            </h2>
            <p className="text-sm text-muted-foreground">
              Buyers read this name when they pick a way in, and it becomes the
              link.
            </p>
          </header>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="flow-name">Name</Label>
            <Input
              id="flow-name"
              value={name}
              autoFocus
              placeholder="Partner sales"
              onChange={(e) => setName(e.target.value)}
              className="max-w-md"
            />
            <p className="font-mono text-xs text-muted-foreground">
              {slug ? `/${slug}` : "the name becomes the link"}
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border">
            <div className="border-b bg-muted/40 px-4 py-3 text-sm font-semibold">
              What you are about to open
            </div>
            <dl className="divide-y">
              <Row k="What it does" v={TYPE_COPY[flowType].label} />
              <Row k="Starting from" v={chosen.name} />
              {preview && (
                <>
                  <Row
                    k="Settings it gets"
                    v={
                      Object.keys(preview.starts_with).length === 0
                        ? "none — everything starts empty"
                        : `${Object.keys(preview.starts_with).length} of ${
                            Object.keys(preview.starts_with).length +
                            preview.left_empty.length
                          }, the rest left for you to decide`
                    }
                  />
                  {preview.not_carried_over.length > 0 && (
                    <Row
                      k="Not carried over"
                      v={preview.not_carried_over.join(", ")}
                      warn
                    />
                  )}
                </>
              )}
              {chosen.kind === "copy" && (
                <Row
                  k="Also copied"
                  v="Its checkout steps and its buyer form, once. The two doors are independent afterwards."
                />
              )}
            </dl>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setStep(2)}>
              Back
            </Button>
            <div className="flex-1" />
            <Button
              disabled={!slug || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? "Creating..." : "Create the flow"}
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}

function StartRow({
  option,
  selected,
  onSelect,
}: {
  option: StartOption
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-xl border p-3.5 text-left transition-colors hover:border-primary",
        selected && "border-primary bg-primary/5",
      )}
    >
      <span className="font-medium">{option.name}</span>
      <span className="text-sm text-muted-foreground">
        {option.description}
      </span>
    </button>
  )
}

function Row({ k, v, warn }: { k: string; v: string; warn?: boolean }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
      <dt className="w-40 shrink-0 text-muted-foreground">{k}</dt>
      <dd className={cn("min-w-0 flex-1", warn && "text-warning")}>{v}</dd>
    </div>
  )
}
