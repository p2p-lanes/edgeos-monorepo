// Static replica of portal/src/components/Card/EventProgressBar.tsx. Shows
// the three canonical stages fully completed (accepted) so the admin sees the
// finished state visually. Labels kept short to avoid overlap at preview scale.

const STAGES: { key: string; label: string }[] = [
  { key: "draft", label: "Draft" },
  { key: "in_review", label: "Submitted" },
  { key: "accepted", label: "Accepted" },
]

export function PreviewProgressBar() {
  return (
    <div className="w-full space-y-2">
      <div className="relative">
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full bg-green-500 transition-all"
            style={{ width: "100%" }}
          />
        </div>
        <div className="absolute inset-x-0 top-0 flex justify-between">
          {STAGES.map((stage) => (
            <div
              key={stage.key}
              className="-mt-1 h-4 w-4 rounded-full border-2 border-white bg-green-500"
            />
          ))}
        </div>
      </div>
      <div className="relative h-6">
        {STAGES.map((stage, i) => (
          <div
            key={stage.key}
            className="absolute text-[11px]"
            style={{
              left: `${(i / (STAGES.length - 1)) * 100}%`,
              transform:
                i === 0
                  ? "translateX(0)"
                  : i === STAGES.length - 1
                    ? "translateX(-100%)"
                    : "translateX(-50%)",
              width: "max-content",
              color: "var(--muted-foreground)",
            }}
          >
            <span className={i === STAGES.length - 1 ? "font-bold" : ""}>
              {stage.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
