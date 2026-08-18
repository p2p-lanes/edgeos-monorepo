// ──────────────────────────────────────────────────────────────────────────
// TourOverlay — the visible half of the product tour.
//
// A full-screen blocker dims the app and swallows clicks (the tour drives the
// navigation; letting the user click through would desync the two). The
// highlighted element is punched out of the dimming by a very large spread
// box-shadow on a rect-sized div, which doubles as the Radix popover anchor
// so collision detection and flipping come for free.
// ──────────────────────────────────────────────────────────────────────────

import { Button } from "@/components/ui/button"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { useTour } from "./TourProvider"
import { useTourAnchor } from "./useTourAnchor"

export function TourOverlay() {
  const { isActive, step, index, steps, isFirst, isLast, next, back, skip } =
    useTour()

  const rect = useTourAnchor(step?.anchor, {
    enabled: isActive && !!step?.anchor,
    onMissing: next,
  })

  if (!isActive || !step) return null

  const card = (
    <TourCard
      title={step.title}
      body={step.body}
      current={index + 1}
      total={steps.length}
      isFirst={isFirst}
      isLast={isLast}
      onNext={next}
      onBack={back}
      onSkip={skip}
    />
  )

  // Centered step — welcome and closing, which belong to no single element.
  if (!step.anchor) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-4">
        <div className="w-full max-w-md rounded-lg border bg-popover p-5 text-popover-foreground shadow-lg">
          {card}
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[200]">
      {rect && (
        <Popover open>
          <PopoverAnchor asChild>
            <div
              data-testid="tour-spotlight"
              className="pointer-events-none fixed rounded-md ring-2 ring-primary transition-all duration-200"
              style={{
                top: rect.top - 4,
                left: rect.left - 4,
                width: rect.width + 8,
                height: rect.height + 8,
                boxShadow: "0 0 0 9999px rgb(0 0 0 / 0.6)",
              }}
            />
          </PopoverAnchor>
          <PopoverContent
            side="right"
            align="start"
            sideOffset={12}
            collisionPadding={16}
            className="z-[201] w-80"
            onInteractOutside={(e) => e.preventDefault()}
            onEscapeKeyDown={(e) => e.preventDefault()}
          >
            {card}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}

interface TourCardProps {
  title: string
  body: string
  current: number
  total: number
  isFirst: boolean
  isLast: boolean
  onNext: () => void
  onBack: () => void
  onSkip: () => void
}

function TourCard({
  title,
  body,
  current,
  total,
  isFirst,
  isLast,
  onNext,
  onBack,
  onSkip,
}: TourCardProps) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {current} / {total}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">{body}</p>

      <div className="mt-1 flex items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onSkip}>
          Skip tour
        </Button>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onBack}
            disabled={isFirst}
          >
            Back
          </Button>
          <Button size="sm" onClick={onNext}>
            {isLast ? "Finish" : "Next"}
          </Button>
        </div>
      </div>
    </div>
  )
}
