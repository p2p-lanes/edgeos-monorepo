import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { PersonBlock } from "./bookingDetail"

/**
 * Who is staying and what they told us.
 *
 * One block per person, because that is how the property owner reads it: a
 * registry is a list of people, not a table of fields. Rows keep the order
 * the questions were asked in, which is the order the guest answered them.
 */
export function GuestDetailsCard({
  blocks,
  guestCount,
}: {
  blocks: PersonBlock[]
  guestCount?: number | null
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-baseline gap-2 text-base">
          Guest details
          {guestCount ? (
            <span className="text-sm font-normal text-muted-foreground">
              {guestCount === 1 ? "1 person" : `${guestCount} people`}
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {blocks.map((block) => (
          <div key={block.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-sm font-medium">
                {block.name || block.title}
              </span>
              {block.name && (
                <span className="text-xs text-muted-foreground">
                  {block.title}
                </span>
              )}
            </div>

            {block.rows.length > 0 && (
              <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {block.rows.map((row) => (
                  <div key={row.key} className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">
                      {row.label}
                      {row.orphaned && (
                        // The question is gone from the form but the answer
                        // is on file. Showing it unlabelled would be worse
                        // than showing it with the key it was stored under.
                        <span className="ml-1 italic">
                          no longer asked
                        </span>
                      )}
                    </dt>
                    <dd className="text-sm">
                      {row.value || (
                        <span className="text-muted-foreground">
                          Not answered
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
