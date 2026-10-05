import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Pencil, Plus, Trash2, Users, X } from "lucide-react"
import { useState } from "react"

import {
  type AllowanceWindow,
  type BadgeAudienceType,
  type BadgeIssuerPolicyPublic,
  type BadgeNewIssuerPolicy,
  BadgesService,
  HumansService,
  PopupsService,
} from "@/client"
import { BadgeArt } from "@/components/Badges/BadgeAwardsList"
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

const AUDIENCE_LABELS: Record<BadgeAudienceType, string> = {
  humans: "Specific people",
  popup_attendees: "Attendees of a gathering",
  tenant: "Everyone",
}

const WINDOW_LABELS: Record<AllowanceWindow, string> = {
  day: "per day",
  week: "per week",
  popup: "per gathering",
  lifetime: "in total",
}

const policiesKey = ["badge-issuer-policies"]

function describeAllowance(policy: {
  allowance_quantity?: number | null
  allowance_window?: AllowanceWindow
}): string {
  if (policy.allowance_quantity == null) return "Unlimited"
  return `${policy.allowance_quantity} ${WINDOW_LABELS[policy.allowance_window ?? "day"]}`
}

function personName(p: {
  first_name?: string | null
  last_name?: string | null
  email: string
}) {
  return [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email
}

export type Person = { id: string; email: string; label: string }

/** A policy for a badge that doesn't exist yet, saved along with it. */
export type PolicyDraft = BadgeNewIssuerPolicy & { people: Person[] }

/** What the API takes for a draft (the people labels are only for display). */
export function draftToPayload({
  people: _people,
  ...policy
}: PolicyDraft): BadgeNewIssuerPolicy {
  return policy
}

export function PeoplePicker({
  value,
  onChange,
}: {
  value: Person[]
  onChange: (people: Person[]) => void
}) {
  const [search, setSearch] = useState("")
  const { data } = useQuery({
    queryKey: ["humans", "picker", search],
    queryFn: () => HumansService.listHumans({ search, limit: 8 }),
    enabled: search.trim().length >= 2,
  })
  const chosen = new Set(value.map((p) => p.id))

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {value.map((p) => (
            <Badge key={p.id} variant="secondary" className="gap-1">
              {p.label}
              <button
                type="button"
                aria-label={`Remove ${p.label}`}
                onClick={() => onChange(value.filter((x) => x.id !== p.id))}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search people by name or email"
      />
      {search.trim().length >= 2 && (
        <div className="max-h-40 overflow-y-auto rounded-md border">
          {(data?.results ?? [])
            .filter((h) => !chosen.has(h.id))
            .map((h) => (
              <button
                type="button"
                key={h.id}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
                onClick={() => {
                  onChange([
                    ...value,
                    { id: h.id, email: h.email, label: personName(h) },
                  ])
                  setSearch("")
                }}
              >
                {personName(h)}
                <span className="ml-2 text-xs text-muted-foreground">
                  {h.email}
                </span>
              </button>
            ))}
          {data && data.results.length === 0 && (
            <p className="px-3 py-2 text-sm text-muted-foreground">
              Nobody matches.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function PolicyDialog({
  open,
  onOpenChange,
  policy,
  defaultBadgeId,
  draft,
  onDraft,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  policy?: BadgeIssuerPolicyPublic
  defaultBadgeId?: string
  // Draft mode, for a badge being created: nothing is saved here, the
  // policy goes back to the caller and is created with the badge.
  draft?: PolicyDraft
  onDraft?: (draft: PolicyDraft) => void
}) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const source = policy ?? draft
  const [name, setName] = useState(source?.name ?? "")
  const [audience, setAudience] = useState<BadgeAudienceType>(
    source?.audience_type ?? "humans",
  )
  const [popupId, setPopupId] = useState(source?.popup_id ?? "")
  const [people, setPeople] = useState<Person[]>(
    draft?.people ??
      (policy?.humans ?? []).map((h) => ({
        id: h.id,
        email: h.email,
        label: personName(h),
      })),
  )
  // In draft mode these are the *other* badges sharing the allowance.
  const [badgeIds, setBadgeIds] = useState<string[]>(
    policy?.badges.map((b) => b.id) ??
      draft?.badge_ids ??
      (defaultBadgeId ? [defaultBadgeId] : []),
  )
  const [limited, setLimited] = useState(
    source ? source.allowance_quantity != null : true,
  )
  const [quantity, setQuantity] = useState(
    String(source?.allowance_quantity ?? 3),
  )
  const [allowanceWindow, setAllowanceWindow] = useState<AllowanceWindow>(
    source?.allowance_window ?? "day",
  )

  const { data: popups } = useQuery({
    queryKey: ["popups", { limit: 100 }],
    queryFn: () => PopupsService.listPopups({ limit: 100 }),
    enabled: open,
  })
  const { data: catalog } = useQuery({
    queryKey: ["badges", { limit: 200 }],
    queryFn: () => BadgesService.listBadges({ limit: 200 }),
    enabled: open,
  })

  const needsPopup =
    audience === "popup_attendees" || allowanceWindow === "popup"

  const body = {
    name: name.trim(),
    audience_type: audience,
    popup_id: popupId || null,
    allowance_quantity: limited ? Number(quantity) : null,
    allowance_window: allowanceWindow,
    badge_ids: badgeIds,
    human_ids: audience === "humans" ? people.map((p) => p.id) : [],
  }

  const save = useMutation({
    mutationFn: () => {
      return policy
        ? BadgesService.updateIssuerPolicy({
            policyId: policy.id,
            requestBody: body,
          })
        : BadgesService.createIssuerPolicy({ requestBody: body })
    },
    onSuccess: () => {
      showSuccessToast(policy ? "Rule updated" : "Rule added")
      queryClient.invalidateQueries({ queryKey: policiesKey })
      onOpenChange(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const invalid =
    !name.trim() ||
    (!onDraft && badgeIds.length === 0) ||
    (needsPopup && !popupId) ||
    (audience === "humans" && people.length === 0) ||
    (limited && !(Number(quantity) >= 1))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{source ? "Edit rule" : "Who can give it"}</DialogTitle>
          <DialogDescription>
            Admins can always give badges. A rule lets other people give them
            too, with an optional allowance.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="policy-name">Name</Label>
            <Input
              id="policy-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Sauna regulars"
            />
          </div>

          <div className="space-y-2">
            <Label>Who</Label>
            <Select
              value={audience}
              onValueChange={(v) => setAudience(v as BadgeAudienceType)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(AUDIENCE_LABELS) as BadgeAudienceType[]).map(
                  (key) => (
                    <SelectItem key={key} value={key}>
                      {AUDIENCE_LABELS[key]}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
            {audience === "humans" && (
              <PeoplePicker value={people} onChange={setPeople} />
            )}
          </div>

          <div className="space-y-2">
            <Label>
              Gathering{" "}
              {!needsPopup && (
                <span className="font-normal text-muted-foreground">
                  (optional, limits the rule to one gathering)
                </span>
              )}
            </Label>
            <Select
              value={popupId || "__any__"}
              onValueChange={(v) => setPopupId(v === "__any__" ? "" : v)}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {!needsPopup && (
                  <SelectItem value="__any__">Any gathering</SelectItem>
                )}
                {(popups?.results ?? []).map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="policy-limited">Allowance per person</Label>
              <Switch
                id="policy-limited"
                checked={limited}
                onCheckedChange={setLimited}
              />
            </div>
            {limited ? (
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-24"
                />
                <Select
                  value={allowanceWindow}
                  onValueChange={(v) =>
                    setAllowanceWindow(v as AllowanceWindow)
                  }
                >
                  <SelectTrigger className="w-44">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(WINDOW_LABELS) as AllowanceWindow[]).map(
                      (key) => (
                        <SelectItem key={key} value={key}>
                          {WINDOW_LABELS[key]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No limit on how many they can give.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Badges</Label>
            <p className="text-xs text-muted-foreground">
              Badges in the same rule share its allowance.
            </p>
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border p-2">
              {onDraft && (
                <div className="flex items-center gap-2 rounded px-1 py-1">
                  <Checkbox id="policy-badge-new" checked disabled />
                  <Label htmlFor="policy-badge-new" className="font-normal">
                    This badge
                  </Label>
                </div>
              )}
              {(catalog?.results ?? []).map((b) => (
                <div
                  key={b.id}
                  className="flex items-center gap-2 rounded px-1 py-1 hover:bg-muted"
                >
                  <Checkbox
                    id={`policy-badge-${b.id}`}
                    checked={badgeIds.includes(b.id)}
                    onCheckedChange={(checked) =>
                      setBadgeIds(
                        checked
                          ? [...badgeIds, b.id]
                          : badgeIds.filter((id) => id !== b.id),
                      )
                    }
                  />
                  <Label
                    htmlFor={`policy-badge-${b.id}`}
                    className="flex cursor-pointer items-center gap-2 font-normal"
                  >
                    <BadgeArt url={b.image_url} className="h-6 w-6" />
                    {b.name}
                  </Label>
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <LoadingButton
            loading={save.isPending}
            disabled={invalid}
            onClick={() => {
              if (onDraft) {
                onDraft({
                  ...body,
                  people: audience === "humans" ? people : [],
                })
                onOpenChange(false)
              } else {
                save.mutate()
              }
            }}
          >
            {source ? "Save rule" : "Add rule"}
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PolicyRow({
  policy,
  badgeId,
}: {
  policy: BadgeIssuerPolicyPublic
  badgeId: string
}) {
  const queryClient = useQueryClient()
  const { isOperatorOrAbove } = useAuth()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [editing, setEditing] = useState(false)
  const remove = useMutation({
    mutationFn: () => BadgesService.deleteIssuerPolicy({ policyId: policy.id }),
    onSuccess: () => {
      showSuccessToast("Rule removed")
      queryClient.invalidateQueries({ queryKey: policiesKey })
    },
    onError: createErrorHandler(showErrorToast),
  })
  const others = policy.badges.filter((b) => b.id !== badgeId)

  return (
    <li className="flex items-start gap-3 py-3">
      <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{policy.name}</span>
          {!policy.is_active && <Badge variant="secondary">Paused</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {policy.audience_type === "humans"
            ? policy.humans.map(personName).join(", ")
            : AUDIENCE_LABELS[policy.audience_type]}
          {" · "}
          {describeAllowance(policy)}
        </p>
        {others.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Shared with: {others.map((b) => b.name).join(", ")}
          </p>
        )}
      </div>
      {isOperatorOrAbove && (
        <div className="flex shrink-0">
          <Button
            size="icon"
            variant="ghost"
            aria-label="Edit rule"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <LoadingButton
            size="icon"
            variant="ghost"
            aria-label="Remove rule"
            loading={remove.isPending}
            onClick={() => {
              if (window.confirm(`Remove the "${policy.name}" rule?`)) {
                remove.mutate()
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
          </LoadingButton>
          {editing && (
            <PolicyDialog
              open={editing}
              onOpenChange={setEditing}
              policy={policy}
              defaultBadgeId={badgeId}
            />
          )}
        </div>
      )}
    </li>
  )
}

/** The rules that let people other than admins give this badge. */
export function IssuerPoliciesCard({ badgeId }: { badgeId: string }) {
  const { isOperatorOrAbove } = useAuth()
  const [adding, setAdding] = useState(false)
  const { data: policies = [] } = useQuery({
    queryKey: [...policiesKey, { badgeId }],
    queryFn: () => BadgesService.listIssuerPolicies({ badgeId }),
  })

  return (
    <Card className="mx-auto max-w-2xl">
      <CardHeader>
        <CardTitle>Who can give it</CardTitle>
        <CardDescription>
          Admins always can. Add rules to let other people give it, like
          regulars of an activity or every attendee.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {policies.length === 0 ? (
          <p className="text-sm text-muted-foreground">Only admins.</p>
        ) : (
          <ul className="divide-y">
            {policies.map((policy) => (
              <PolicyRow key={policy.id} policy={policy} badgeId={badgeId} />
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
              <PolicyDialog
                open={adding}
                onOpenChange={setAdding}
                defaultBadgeId={badgeId}
              />
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

/**
 * "Who can give it" for a badge that's still being created: the policies
 * are kept here and saved together with the badge.
 */
export function DraftIssuerPolicies({
  value,
  onChange,
}: {
  value: PolicyDraft[]
  onChange: (value: PolicyDraft[]) => void
}) {
  // undefined = closed, -1 = adding, otherwise the index being edited.
  const [editing, setEditing] = useState<number | undefined>()

  return (
    <div className="space-y-3">
      {value.length === 0 ? (
        <p className="text-sm text-muted-foreground">Only admins.</p>
      ) : (
        <ul className="divide-y rounded-md border px-3">
          {value.map((draft, index) => (
            <li
              key={`${draft.name}-${index}`}
              className="flex items-start gap-3 py-3"
            >
              <Users className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <span className="font-medium">{draft.name}</span>
                <p className="text-sm text-muted-foreground">
                  {draft.audience_type === "humans"
                    ? draft.people.map((p) => p.label).join(", ")
                    : AUDIENCE_LABELS[draft.audience_type]}
                  {" · "}
                  {describeAllowance(draft)}
                </p>
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Edit rule"
                onClick={() => setEditing(index)}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                aria-label="Remove rule"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setEditing(-1)}
      >
        <Plus className="mr-1 h-4 w-4" />
        Add rule
      </Button>
      {editing !== undefined && (
        <PolicyDialog
          open
          onOpenChange={(open) => !open && setEditing(undefined)}
          draft={editing >= 0 ? value[editing] : undefined}
          onDraft={(draft) =>
            onChange(
              editing >= 0
                ? value.map((d, i) => (i === editing ? draft : d))
                : [...value, draft],
            )
          }
        />
      )}
    </div>
  )
}
