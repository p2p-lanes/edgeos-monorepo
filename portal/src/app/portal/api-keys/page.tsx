"use client"

import { format } from "date-fns"
import { Check, Copy, Key, Loader2, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
import { useApiKeys } from "@/hooks/useApiKeys"
import type {
  ApiKeyCreated,
  ApiKeyPublic,
  ApiKeyScope,
} from "@/lib/apiKeysService"

const DEFAULT_SCOPES: ApiKeyScope[] = ["events:read"]

const SCOPE_OPTIONS: Array<{
  value: ApiKeyScope
  label: string
  description: string
}> = [
  {
    value: "events:read",
    label: "Read events",
    description:
      "List events and read the context needed for event automation.",
  },
  {
    value: "rsvp:write",
    label: "RSVP to events",
    description: "Register or cancel attendance for events.",
  },
]

export default function ApiKeysPage() {
  const { t } = useTranslation()
  const {
    keys,
    isLoading,
    error,
    createKey,
    isCreating,
    revokeKey,
    isRevoking,
  } = useApiKeys()

  const [createOpen, setCreateOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState("")
  const [selectedScopes, setSelectedScopes] =
    useState<ApiKeyScope[]>(DEFAULT_SCOPES)
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null)
  const [copied, setCopied] = useState(false)
  const [pendingRevoke, setPendingRevoke] = useState<ApiKeyPublic | null>(null)

  const toggleScope = (scope: ApiKeyScope, checked: boolean) => {
    setSelectedScopes((current) => {
      if (scope === "events:read" && !checked) {
        return current
      }
      if (checked) {
        return current.includes(scope) ? current : [...current, scope]
      }
      return current.filter((item) => item !== scope)
    })
  }

  const onCreate = async () => {
    const name = newKeyName.trim()
    if (!name) return
    try {
      const created = await createKey({
        name,
        scopes: selectedScopes,
        expires_at: null,
      })
      setCreatedKey(created)
      setNewKeyName("")
      setSelectedScopes(DEFAULT_SCOPES)
      setCreateOpen(false)
    } catch {
      toast.error(
        t("api_keys.create_failed", {
          defaultValue: "Failed to create API key",
        }),
      )
    }
  }

  const onCopy = async () => {
    if (!createdKey) return
    await navigator.clipboard.writeText(createdKey.key)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const onRevokeConfirm = async () => {
    if (!pendingRevoke) return
    try {
      await revokeKey(pendingRevoke.id)
      toast.success(t("api_keys.revoked", { defaultValue: "API key revoked" }))
    } catch {
      toast.error(
        t("api_keys.revoke_failed", {
          defaultValue: "Failed to revoke API key",
        }),
      )
    } finally {
      setPendingRevoke(null)
    }
  }

  const isActive = (k: ApiKeyPublic) =>
    !k.revoked_at && (!k.expires_at || new Date(k.expires_at) > new Date())

  return (
    <div className="flex-1 p-6 bg-background">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <Key className="size-6" />
              {t("api_keys.title", { defaultValue: "API Keys" })}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t("api_keys.description", {
                defaultValue:
                  "Personal access tokens that act on your behalf. Use them with agents or scripts to access the Events API.",
              })}
            </p>
          </div>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="size-4 mr-1" />
            {t("api_keys.new_key", { defaultValue: "New key" })}
          </Button>
        </div>

        {error && (
          <Card>
            <CardContent className="py-6">
              <p className="text-sm text-destructive">
                {t("api_keys.load_failed", {
                  defaultValue: "Failed to load API keys.",
                })}
              </p>
            </CardContent>
          </Card>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : keys.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <p className="text-sm text-muted-foreground">
                {t("api_keys.empty", {
                  defaultValue:
                    "You don't have any API keys yet. Create one to get started.",
                })}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {keys.map((k) => {
              const active = isActive(k)
              return (
                <Card key={k.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between gap-3">
                      <CardTitle className="text-base">{k.name}</CardTitle>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full ${
                          active
                            ? "bg-emerald-100 text-emerald-700"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {active
                          ? t("api_keys.status_active", {
                              defaultValue: "Active",
                            })
                          : k.revoked_at
                            ? t("api_keys.status_revoked", {
                                defaultValue: "Revoked",
                              })
                            : t("api_keys.status_expired", {
                                defaultValue: "Expired",
                              })}
                      </span>
                    </div>
                  </CardHeader>
                  <CardContent className="text-sm text-muted-foreground space-y-1">
                    <div className="font-mono text-xs">{k.prefix}…</div>
                    <div>
                      {t("api_keys.scopes", { defaultValue: "Scopes" })}:{" "}
                      {k.scopes.join(", ")}
                    </div>
                    <div>
                      {t("api_keys.created", { defaultValue: "Created" })}:{" "}
                      {format(new Date(k.created_at), "PP")}
                    </div>
                    {k.last_used_at && (
                      <div>
                        {t("api_keys.last_used", {
                          defaultValue: "Last used",
                        })}
                        : {format(new Date(k.last_used_at), "PPp")}
                      </div>
                    )}
                    {k.expires_at && (
                      <div>
                        {t("api_keys.expires", { defaultValue: "Expires" })}:{" "}
                        {format(new Date(k.expires_at), "PP")}
                      </div>
                    )}
                    {active && (
                      <div className="pt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPendingRevoke(k)}
                        >
                          <Trash2 className="size-3.5 mr-1" />
                          {t("api_keys.revoke", { defaultValue: "Revoke" })}
                        </Button>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("api_keys.create_title", { defaultValue: "Create API key" })}
            </DialogTitle>
            <DialogDescription>
              {t("api_keys.create_description", {
                defaultValue:
                  "Pick a recognisable name. The token will be shown once after creation — copy it then.",
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="api-key-name">
              {t("api_keys.name_label", { defaultValue: "Name" })}
            </Label>
            <Input
              id="api-key-name"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder={t("api_keys.name_placeholder", {
                defaultValue: "e.g. Claude assistant",
              })}
              maxLength={100}
              autoFocus
            />
          </div>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label>
                {t("api_keys.scopes_label", { defaultValue: "Permissions" })}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("api_keys.scopes_description", {
                  defaultValue:
                    "New keys start with read-only access. Only enable broader permissions when you really need them.",
                })}
              </p>
            </div>
            <div className="space-y-3 rounded-md border p-3">
              {SCOPE_OPTIONS.map((scope) => {
                const checked = selectedScopes.includes(scope.value)
                const checkboxId = `scope-${scope.value}`
                return (
                  <div key={scope.value} className="flex items-start gap-3">
                    <Checkbox
                      id={checkboxId}
                      checked={checked}
                      disabled={scope.value === "events:read"}
                      onCheckedChange={(value) =>
                        toggleScope(scope.value, value === true)
                      }
                    />
                    <div className="space-y-1">
                      <Label
                        htmlFor={checkboxId}
                        className="text-sm font-medium cursor-pointer"
                      >
                        {t(`api_keys.scope.${scope.value}.label`, {
                          defaultValue: scope.label,
                        })}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {t(`api_keys.scope.${scope.value}.description`, {
                          defaultValue: scope.description,
                        })}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              onClick={onCreate}
              disabled={
                !newKeyName.trim() || isCreating || selectedScopes.length === 0
              }
            >
              {isCreating && <Loader2 className="size-4 animate-spin mr-1" />}
              {t("api_keys.create", { defaultValue: "Create" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createdKey !== null}
        onOpenChange={(open) => {
          if (!open) setCreatedKey(null)
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {t("api_keys.created_title", {
                defaultValue: "API key created",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("api_keys.created_warning", {
                defaultValue:
                  "Copy this token now. You won't be able to see it again — if you lose it, revoke and create a new one.",
              })}
            </DialogDescription>
          </DialogHeader>
          {createdKey && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/40 p-3 text-xs text-muted-foreground">
                {t("api_keys.created_scopes", {
                  defaultValue: "Permissions",
                })}
                :{" "}
                <span className="font-mono">
                  {createdKey.scopes.join(", ")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 bg-muted rounded text-xs break-all font-mono">
                  {createdKey.key}
                </code>
                <Button
                  variant="outline"
                  size="icon"
                  onClick={onCopy}
                  aria-label={t("api_keys.copy", { defaultValue: "Copy" })}
                >
                  {copied ? (
                    <Check className="size-4 text-emerald-600" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </Button>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setCreatedKey(null)}>
              {t("api_keys.done", { defaultValue: "Done" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={pendingRevoke !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRevoke(null)
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>
              {t("api_keys.revoke_title", { defaultValue: "Revoke API key" })}
            </DialogTitle>
            <DialogDescription>
              {t("api_keys.revoke_description", {
                defaultValue:
                  "This action cannot be undone. Anything using this token will immediately stop working.",
              })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPendingRevoke(null)}>
              {t("common.cancel", { defaultValue: "Cancel" })}
            </Button>
            <Button
              variant="destructive"
              onClick={onRevokeConfirm}
              disabled={isRevoking}
            >
              {isRevoking && <Loader2 className="size-4 animate-spin mr-1" />}
              {t("api_keys.revoke", { defaultValue: "Revoke" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
