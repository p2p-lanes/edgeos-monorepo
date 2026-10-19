/** Render and interpret a wall-clock deadline in the popup's configured time zone. */
export function deadlineInZone(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso))
  const part = (type: string) => parts.find((p) => p.type === type)?.value
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`
}

export function deadlineToUtc(local: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) {
    throw new Error(
      "Use YYYY-MM-DD for the date and HH:mm (24-hour) for the time.",
    )
  }
  const target = Date.parse(`${local}:00Z`)
  if (
    Number.isFinite(target) &&
    new Date(target).toISOString().slice(0, 16) !== local
  ) {
    throw new Error("Choose a valid deadline date and time.")
  }
  if (!Number.isFinite(target)) throw new Error("Choose an editing deadline")
  let guess = target
  for (let i = 0; i < 4; i++) {
    const wall = Date.parse(
      `${deadlineInZone(new Date(guess).toISOString(), timeZone)}:00Z`,
    )
    const difference = target - wall
    if (!difference) return new Date(guess).toISOString()
    guess += difference
  }
  throw new Error("This time does not exist in the selected time zone")
}
