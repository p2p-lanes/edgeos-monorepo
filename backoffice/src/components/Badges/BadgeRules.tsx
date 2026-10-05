import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil, Plus, RefreshCw, Trash2, Users, Zap } from "lucide-react"
import { useEffect, useMemo, useState } from "react"

import {
  type BadgeRulePublic,
  BadgesService,
  EventVenuesService,
  PopupsService,
  TracksService,
} from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import { Switch } from "@/components/ui/switch"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"
import {
  ConditionEditor,
  type FilterKey,
  filtersInUse,
} from "./rules/ConditionEditor"
import { type Condition, describeRule, type RuleNames } from "./rules/ruleText"

const rulesKey = ["badge-rules"]
const MAX_CONDITIONS = 5

function useNames(): RuleNames & {
  popups: { value: string; label: string }[]
} {
  const { data: popups } = useQuery({
    queryKey: ["popups", { limit: 100 }],
    queryFn: () => PopupsService.listPopups({ limit: 100 }),
  })
  const { data: tracks } = useQuery({
    queryKey: ["tracks", { limit: 500 }],
    queryFn: () => TracksService.listTracks({ limit: 500 }),
  })
  const { data: venues } = useQuery({
    queryKey: ["event-venues", { limit: 500 }],
    queryFn: () => EventVenuesService.listVenues({ limit: 500 }),
  })
  return {
    popups: (popups?.results ?? []).map((p) => ({
      value: p.id,
      label: p.name,
    })),
    popup: (id) =>
      popups?.results.find((p) => p.id === id)?.name ?? "a gathering",
    track: (id) => tracks?.results.find((t) => t.id === id)?.name ?? "a track",
    venue: (id) => venues?.results.find((v) => v.id === id)?.title ?? "a venue",
  }
}

function blankCondition(popupId: string | null = null): Condition {
  return {
    activity: "attend",
    measure: "count",
    threshold: 5,
    filters: { popup_id: popupId },
  }
}

/** Why the conditions can't be saved yet, or null when they can. */
function problem(conditions: Condition[]): string | null {
  for (const c of conditions) {
    if (!Number.isInteger(c.threshold) || c.threshold < 1) {
      return "Each condition needs a number of at least 1."
    }
    const f = c.filters ?? {}
    if (
      f.starts_after &&
      f.starts_before &&
      f.starts_after >= f.starts_before
    ) {
      return "The start time range ends before it begins."
    }
    if (f.date_from && f.date_to && f.date_from > f.date_to) {
      return "The date range ends before it begins."
    }
  }
  return null
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

function Preview({
  badgeId,
  conditions,
}: {
  badgeId: string
  conditions: Condition[]
}) {
  const config = useDebounced(
    useMemo(() => ({ conditions }), [conditions]),
    500,
  )
  const valid = problem(config.conditions) === null
  const { data, isFetching, isError } = useQuery({
    queryKey: [...rulesKey, "preview", badgeId, config],
    queryFn: () =>
      BadgesService.previewBadgeRule({
        requestBody: { badge_id: badgeId, config },
      }),
    enabled: valid,
    staleTime: 30_000,
  })
  if (!valid || isError) return null
  return (
    <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <Users className="h-4 w-4" />
      {!data || isFetching
        ? "Counting who qualifies…"
        : data.qualified === 0
          ? "Nobody meets this yet."
          : `${data.qualified} ${data.qualified === 1 ? "person meets" : "people meet"} this today${
              data.new_recipients < data.qualified
                ? `, ${data.new_recipients} without the badge yet`
                : ""
            }.`}
    </p>
  )
}

function RuleDialog({
  open,
  onOpenChange,
  badgeId,
  rule,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  badgeId: string
  rule?: BadgeRulePublic
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const names = useNames()
  const [conditions, setConditions] = useState<Condition[]>(
    () => rule?.config.conditions ?? [blankCondition()],
  )
  const [shown, setShown] = useState<FilterKey[][]>(() =>
    (rule?.config.conditions ?? [blankCondition()]).map((c) =>
      filtersInUse(c.filters),
    ),
  )
  const [applyNow, setApplyNow] = useState(true)

  const save = useMutation({
    mutationFn: async () => {
      const config = { conditions }
      if (!rule) {
        return BadgesService.createBadgeRule({
          requestBody: { badge_id: badgeId, config, evaluate_now: applyNow },
        })
      }
      const updated = await BadgesService.updateBadgeRule({
        ruleId: rule.id,
        requestBody: { config },
      })
      if (applyNow && updated.is_active) {
        await BadgesService.evaluateBadgeRule({ ruleId: rule.id })
        return BadgesService.listBadgeRules({ badgeId }).then(
          (all) => all.find((r) => r.id === rule.id) ?? updated,
        )
      }
      return updated
    },
    onSuccess: (saved) => {
      const before = rule?.award_count ?? 0
      const gained = (saved.award_count ?? 0) - before
      showSuccessToast(
        gained > 0
          ? `Rule saved. ${gained} ${gained === 1 ? "person" : "people"} got the badge.`
          : "Rule saved",
      )
      queryClient.invalidateQueries({ queryKey: rulesKey })
      queryClient.invalidateQueries({ queryKey: ["badge-awards"] })
      queryClient.invalidateQueries({ queryKey: ["badges"] })
      onOpenChange(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const update = (index: number, next: Condition) =>
    setConditions((all) => all.map((c, i) => (i === index ? next : c)))
  const remove = (index: number) => {
    setConditions((all) => all.filter((_, i) => i !== index))
    setShown((all) => all.filter((_, i) => i !== index))
  }
  const add = () => {
    setConditions((all) => [
      ...all,
      blankCondition(all[0]?.filters?.popup_id ?? null),
    ])
    setShown((all) => [...all, []])
  }
  const blocker = problem(conditions)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {rule ? "Edit rule" : "Earn it automatically"}
          </DialogTitle>
          <DialogDescription>
            People get this badge on their own once they meet every condition.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {conditions.map((condition, index) => (
            <div key={index} className="space-y-3">
              {index > 0 && (
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  and also
                </p>
              )}
              <ConditionEditor
                index={index}
                condition={condition}
                shown={shown[index] ?? []}
                popups={names.popups}
                onChange={(next) => update(index, next)}
                onShownChange={(next) =>
                  setShown((all) => all.map((s, i) => (i === index ? next : s)))
                }
                onRemove={
                  conditions.length > 1 ? () => remove(index) : undefined
                }
              />
            </div>
          ))}
          {conditions.length < MAX_CONDITIONS && (
            <Button type="button" variant="ghost" size="sm" onClick={add}>
              <Plus className="mr-1 h-4 w-4" />
              Add another condition
            </Button>
          )}
        </div>

        <div className="space-y-2 rounded-md bg-muted/50 p-3">
          <ul className="space-y-0.5 text-sm">
            {describeRule(conditions, names).map((line, i) => (
              <li key={i}>
                {i > 0 && <span className="text-muted-foreground">and </span>}
                {line}
              </li>
            ))}
          </ul>
          {blocker ? (
            <p className="text-sm text-destructive">{blocker}</p>
          ) : (
            <Preview badgeId={badgeId} conditions={conditions} />
          )}
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="rule-apply-now"
            checked={applyNow}
            onCheckedChange={(v) => setApplyNow(v === true)}
          />
          <Label htmlFor="rule-apply-now" className="font-normal">
            Also give it now to people who already qualify
          </Label>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton
            loading={save.isPending}
            disabled={blocker !== null}
            onClick={() => save.mutate()}
          >
            {rule ? "Save rule" : "Add rule"}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RuleRow({
  rule,
  names,
  onEdit,
}: {
  rule: BadgeRulePublic
  names: RuleNames
  onEdit: () => void
}) {
  const queryClient = useQueryClient()
  const { isOperatorOrAbove } = useAuth()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const onError = createErrorHandler(showErrorToast)
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: rulesKey })
    queryClient.invalidateQueries({ queryKey: ["badge-awards"] })
    queryClient.invalidateQueries({ queryKey: ["badges"] })
  }

  const toggle = useMutation({
    mutationFn: (isActive: boolean) =>
      BadgesService.updateBadgeRule({
        ruleId: rule.id,
        requestBody: { is_active: isActive },
      }),
    onSuccess: refresh,
    onError,
  })
  const evaluate = useMutation({
    mutationFn: () => BadgesService.evaluateBadgeRule({ ruleId: rule.id }),
    onSuccess: (result) => {
      showSuccessToast(
        result.awarded
          ? `Given to ${result.awarded} more ${result.awarded === 1 ? "person" : "people"}`
          : "Nobody new qualifies yet",
      )
      refresh()
    },
    onError,
  })
  const remove = useMutation({
    mutationFn: () => BadgesService.deleteBadgeRule({ ruleId: rule.id }),
    onSuccess: () => {
      showSuccessToast("Rule removed. Badges it gave are kept.")
      refresh()
    },
    onError,
  })

  return (
    <li className="flex items-start gap-3 py-3">
      <Zap className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        {describeRule(rule.config.conditions, names).map((line, i) => (
          <p key={i} className="font-medium">
            {i > 0 && (
              <span className="font-normal text-muted-foreground">and </span>
            )}
            {line}
          </p>
        ))}
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {!rule.is_active && <Badge variant="secondary">Paused</Badge>}
          Given to {rule.award_count}{" "}
          {rule.award_count === 1 ? "person" : "people"}
        </div>
      </div>
      {isOperatorOrAbove && (
        <div className="flex shrink-0 items-center gap-1">
          <Switch
            checked={rule.is_active}
            disabled={toggle.isPending}
            onCheckedChange={(v) => toggle.mutate(v)}
            aria-label="Rule active"
          />
          <Button
            size="icon"
            variant="ghost"
            aria-label="Edit rule"
            onClick={onEdit}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <LoadingButton
            size="icon"
            variant="ghost"
            aria-label="Apply now"
            title="Give it now to everyone who qualifies"
            loading={evaluate.isPending}
            disabled={!rule.is_active}
            onClick={() => evaluate.mutate()}
          >
            <RefreshCw className="h-4 w-4" />
          </LoadingButton>
          <LoadingButton
            size="icon"
            variant="ghost"
            aria-label="Remove rule"
            loading={remove.isPending}
            onClick={() => {
              if (
                window.confirm(
                  "Remove this rule? People keep the badges it already gave.",
                )
              ) {
                remove.mutate()
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
          </LoadingButton>
        </div>
      )}
    </li>
  )
}

/** Rules that hand out this badge automatically from attendance or hosting. */
export function BadgeRulesCard({ badgeId }: { badgeId: string }) {
  const { isOperatorOrAbove } = useAuth()
  const names = useNames()
  // undefined = closed, null = creating, a rule = editing it.
  const [editing, setEditing] = useState<BadgeRulePublic | null | undefined>()
  const { data: rules = [] } = useQuery({
    queryKey: [...rulesKey, { badgeId }],
    queryFn: () => BadgesService.listBadgeRules({ badgeId }),
  })

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Earned automatically</CardTitle>
        <CardDescription>
          Give it on its own when people show up or host enough. Check-ins count
          once they can no longer be voided, so the badge arrives about two
          hours after the event ends. Each rule gives it to a person once; if
          you remove it from someone, the rule won't give it back.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rules.</p>
        ) : (
          <ul className="divide-y">
            {rules.map((rule) => (
              <RuleRow
                key={rule.id}
                rule={rule}
                names={names}
                onEdit={() => setEditing(rule)}
              />
            ))}
          </ul>
        )}
        {isOperatorOrAbove && (
          <Button variant="outline" size="sm" onClick={() => setEditing(null)}>
            <Plus className="mr-1 h-4 w-4" />
            Add rule
          </Button>
        )}
        {editing !== undefined && (
          <RuleDialog
            key={editing?.id ?? "new"}
            open
            onOpenChange={(open) => !open && setEditing(undefined)}
            badgeId={badgeId}
            rule={editing ?? undefined}
          />
        )}
      </CardContent>
    </Card>
  )
}
