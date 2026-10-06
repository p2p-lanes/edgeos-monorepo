import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Plus, RefreshCw, Trash2, Zap } from "lucide-react"
import { useState } from "react"

import {
  type BadgeRulePublic,
  BadgesService,
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { LoadingButton } from "@/components/ui/loading-button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

type RuleKind = "checkins_in_track" | "checkins_in_popup"

const rulesKey = ["badge-rules"]

function useNames() {
  const { data: popups } = useQuery({
    queryKey: ["popups", { limit: 100 }],
    queryFn: () => PopupsService.listPopups({ limit: 100 }),
  })
  const { data: tracks } = useQuery({
    queryKey: ["tracks", { limit: 500 }],
    queryFn: () => TracksService.listTracks({ limit: 500 }),
  })
  return {
    popups: popups?.results ?? [],
    popupName: (id: string) =>
      popups?.results.find((p) => p.id === id)?.name ?? "a gathering",
    trackName: (id: string) =>
      tracks?.results.find((t) => t.id === id)?.name ?? "a track",
  }
}

function describe(
  rule: BadgeRulePublic,
  names: ReturnType<typeof useNames>,
): string {
  const { config } = rule
  const times = `${config.threshold} check-in${config.threshold === 1 ? "" : "s"}`
  // The generated type marks the discriminator optional, so narrow on the
  // field each config actually carries.
  return "track_id" in config
    ? `After ${times} at ${names.trackName(config.track_id)} events`
    : `After ${times} at any event of ${names.popupName(config.popup_id)}`
}

function AddRuleDialog({
  open,
  onOpenChange,
  badgeId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  badgeId: string
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const { popups } = useNames()
  const [kind, setKind] = useState<RuleKind>("checkins_in_track")
  const [popupId, setPopupId] = useState("")
  const [trackId, setTrackId] = useState("")
  const [threshold, setThreshold] = useState("5")
  const [evaluateNow, setEvaluateNow] = useState(true)

  const { data: tracks } = useQuery({
    queryKey: ["tracks", { popupId }],
    queryFn: () => TracksService.listTracks({ popupId, limit: 200 }),
    enabled: !!popupId && kind === "checkins_in_track",
  })

  const create = useMutation({
    mutationFn: () =>
      BadgesService.createBadgeRule({
        requestBody: {
          badge_id: badgeId,
          evaluate_now: evaluateNow,
          config:
            kind === "checkins_in_track"
              ? {
                  type: "checkins_in_track",
                  track_id: trackId,
                  threshold: Number(threshold),
                }
              : {
                  type: "checkins_in_popup",
                  popup_id: popupId,
                  threshold: Number(threshold),
                },
        },
      }),
    onSuccess: (rule) => {
      showSuccessToast(
        rule.award_count
          ? `Rule added. ${rule.award_count} people already earned it.`
          : "Rule added",
      )
      queryClient.invalidateQueries({ queryKey: rulesKey })
      queryClient.invalidateQueries({ queryKey: ["badge-awards"] })
      queryClient.invalidateQueries({ queryKey: ["badges"] })
      onOpenChange(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const invalid =
    !popupId ||
    (kind === "checkins_in_track" && !trackId) ||
    !(Number(threshold) >= 1)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Earn it automatically</DialogTitle>
          <DialogDescription>
            People get this badge on their own once their check-ins reach the
            number you set.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Count check-ins at</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as RuleKind)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="checkins_in_track">
                  Events of a track
                </SelectItem>
                <SelectItem value="checkins_in_popup">
                  Any event of a gathering
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Gathering</Label>
            <Select
              value={popupId}
              onValueChange={(v) => {
                setPopupId(v)
                setTrackId("")
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pick a gathering" />
              </SelectTrigger>
              <SelectContent>
                {popups.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {kind === "checkins_in_track" && (
            <div className="space-y-2">
              <Label>Track</Label>
              <Select
                value={trackId}
                onValueChange={setTrackId}
                disabled={!popupId}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Pick a track" />
                </SelectTrigger>
                <SelectContent>
                  {(tracks?.results ?? []).map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {popupId && tracks && tracks.results.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  This gathering has no tracks yet.
                </p>
              )}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="rule-threshold">Check-ins needed</Label>
            <Input
              id="rule-threshold"
              type="number"
              min={1}
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="w-24"
            />
            <p className="text-xs text-muted-foreground">
              Each event date counts once. Voided check-ins don't count.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="rule-evaluate-now"
              checked={evaluateNow}
              onCheckedChange={(v) => setEvaluateNow(v === true)}
            />
            <Label htmlFor="rule-evaluate-now" className="font-normal">
              Also give it now to people who already qualify
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton
            loading={create.isPending}
            disabled={invalid}
            onClick={() => create.mutate()}
          >
            Add rule
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RuleRow({
  rule,
  names,
}: {
  rule: BadgeRulePublic
  names: ReturnType<typeof useNames>
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
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{describe(rule, names)}</span>
          {!rule.is_active && <Badge variant="secondary">Paused</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          Given to {rule.award_count}{" "}
          {rule.award_count === 1 ? "person" : "people"}
        </p>
      </div>
      {isOperatorOrAbove && (
        <div className="flex shrink-0 items-center gap-1">
          <Switch
            checked={rule.is_active}
            disabled={toggle.isPending}
            onCheckedChange={(v) => toggle.mutate(v)}
            aria-label="Rule active"
          />
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

/** Rules that hand out this badge automatically from check-ins. */
export function BadgeRulesCard({ badgeId }: { badgeId: string }) {
  const { isOperatorOrAbove } = useAuth()
  const names = useNames()
  const [adding, setAdding] = useState(false)
  const { data: rules = [] } = useQuery({
    queryKey: [...rulesKey, { badgeId }],
    queryFn: () => BadgesService.listBadgeRules({ badgeId }),
  })

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Earned automatically</CardTitle>
        <CardDescription>
          Give it on its own when people show up enough. Each rule gives it to a
          person once; if you remove it from someone, the rule won't give it
          back.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">No rules.</p>
        ) : (
          <ul className="divide-y">
            {rules.map((rule) => (
              <RuleRow key={rule.id} rule={rule} names={names} />
            ))}
          </ul>
        )}
        {isOperatorOrAbove && (
          <>
            <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Add rule
            </Button>
            {adding && (
              <AddRuleDialog
                open={adding}
                onOpenChange={setAdding}
                badgeId={badgeId}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
