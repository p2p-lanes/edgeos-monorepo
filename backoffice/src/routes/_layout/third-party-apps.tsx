import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { AlertTriangle, Building2, Check, Copy, Plus } from "lucide-react"
import { useState } from "react"

import {
  type AvailableScopes,
  type ThirdPartyAppCreate,
  type ThirdPartyAppCreated,
  type ThirdPartyAppPublic,
  ThirdPartyAppsService,
  type ThirdPartyAppUpdate,
} from "@/client"
import { DataTable } from "@/components/Common/DataTable"
import { EmptyState } from "@/components/Common/EmptyState"
import { QueryErrorBoundary } from "@/components/Common/QueryErrorBoundary"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
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
import { Skeleton } from "@/components/ui/skeleton"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

export const Route = createFileRoute("/_layout/third-party-apps")({
  component: ThirdPartyAppsPage,
  head: () => ({
    meta: [{ title: "Third-party Apps - EdgeOS" }],
  }),
})

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "Never"
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
    >
      {copied ? (
        <>
          <Check className="mr-2 h-4 w-4" />
          Copied
        </>
      ) : (
        <>
          <Copy className="mr-2 h-4 w-4" />
          Copy key
        </>
      )}
    </Button>
  )
}

function RevealKeyDialog({
  rawKey,
  title,
  onClose,
}: {
  rawKey: string
  title: string
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Save this key now. You will not be able to see it again.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            <p className="text-xs text-muted-foreground">
              Store this key securely. Anyone with it can authenticate portal
              users under this tenant. Rotate immediately if compromised.
            </p>
          </div>
          <div className="rounded-md border bg-background p-3 font-mono text-sm break-all select-all">
            {rawKey}
          </div>
          <CopyButton value={rawKey} />
        </div>
        <DialogFooter>
          <Button onClick={onClose}>I have saved it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ScopeGroup({
  label,
  scopes,
  selectedScopes,
  onToggle,
}: {
  label: string
  scopes: string[]
  selectedScopes: string[]
  onToggle: (scope: string) => void
}) {
  if (scopes.length === 0) return null
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        {scopes.map((scope) => {
          const isSelected = selectedScopes.includes(scope)
          return (
            <button
              key={scope}
              type="button"
              onClick={() => onToggle(scope)}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                isSelected
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/30 bg-background text-muted-foreground hover:border-primary/50 hover:text-foreground"
              }`}
            >
              {scope}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function CreateAppDialog({
  availableScopes,
  onClose,
  onCreated,
}: {
  availableScopes: AvailableScopes
  onClose: () => void
  onCreated: (rawKey: string) => void
}) {
  const { showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()

  const [name, setName] = useState("")
  const [tokenScopes, setTokenScopes] = useState<string[]>([])
  const [apiKeyScopes, setApiKeyScopes] = useState<string[]>([])
  const [nameError, setNameError] = useState("")
  const [scopeError, setScopeError] = useState("")

  const createMutation = useMutation({
    mutationFn: () =>
      ThirdPartyAppsService.createThirdPartyApp({
        requestBody: {
          name: name.trim(),
          allowed_token_scopes:
            tokenScopes as ThirdPartyAppCreate["allowed_token_scopes"],
          allowed_api_key_scopes:
            apiKeyScopes as ThirdPartyAppCreate["allowed_api_key_scopes"],
        },
      }),
    onSuccess: (result: ThirdPartyAppCreated) => {
      queryClient.invalidateQueries({ queryKey: ["third-party-apps"] })
      onCreated(result.raw_key)
    },
    onError: createErrorHandler(showErrorToast),
  })

  function toggleScope(
    scope: string,
    current: string[],
    setter: (v: string[]) => void,
  ) {
    setter(
      current.includes(scope)
        ? current.filter((s) => s !== scope)
        : [...current, scope],
    )
    setScopeError("")
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    let valid = true
    if (!name.trim()) {
      setNameError("Name is required")
      valid = false
    }
    if (tokenScopes.length === 0) {
      setScopeError("Select at least one token scope")
      valid = false
    }
    if (!valid) return
    createMutation.mutate()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create third-party app</DialogTitle>
            <DialogDescription>
              Register a new integration credential. The raw key is shown once
              after creation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label htmlFor="app-name">Name</Label>
              <Input
                id="app-name"
                placeholder="e.g. Acme Integration"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameError("")
                }}
              />
              {nameError && (
                <p className="text-sm text-destructive">{nameError}</p>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <Label>Token scopes</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Scopes the JWT minted by this app can carry.
                </p>
              </div>
              {scopeError && (
                <p className="text-sm text-destructive">{scopeError}</p>
              )}
              <ScopeGroup
                label="Portal"
                scopes={availableScopes.token_scopes}
                selectedScopes={tokenScopes}
                onToggle={(s) => toggleScope(s, tokenScopes, setTokenScopes)}
              />
            </div>

            <div className="space-y-3">
              <div>
                <Label>API key scopes</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Scopes the app is allowed to request when minting API keys.
                </p>
              </div>
              <ScopeGroup
                label="API keys"
                scopes={availableScopes.api_key_scopes}
                selectedScopes={apiKeyScopes}
                onToggle={(s) => toggleScope(s, apiKeyScopes, setApiKeyScopes)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <LoadingButton type="submit" loading={createMutation.isPending}>
              Create app
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditAppDialog({
  app,
  availableScopes,
  onClose,
}: {
  app: ThirdPartyAppPublic
  availableScopes: AvailableScopes
  onClose: () => void
}) {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()

  const validTokenScopes = new Set(availableScopes.token_scopes)
  const validApiKeyScopes = new Set(availableScopes.api_key_scopes)

  const legacyTokenScopes = app.allowed_token_scopes.filter(
    (s) => !validTokenScopes.has(s),
  )
  const legacyApiKeyScopes = app.allowed_api_key_scopes.filter(
    (s) => !validApiKeyScopes.has(s),
  )

  const [name, setName] = useState(app.name)
  const [tokenScopes, setTokenScopes] = useState<string[]>(() =>
    app.allowed_token_scopes.filter((s) => validTokenScopes.has(s)),
  )
  const [apiKeyScopes, setApiKeyScopes] = useState<string[]>(() =>
    app.allowed_api_key_scopes.filter((s) => validApiKeyScopes.has(s)),
  )
  const [nameError, setNameError] = useState("")
  const [scopeError, setScopeError] = useState("")

  const updateMutation = useMutation({
    mutationFn: () => {
      const requestBody: ThirdPartyAppUpdate = {}
      const trimmedName = name.trim()
      if (trimmedName !== app.name) {
        requestBody.name = trimmedName
      }
      if (!sameScopes(tokenScopes, app.allowed_token_scopes)) {
        requestBody.allowed_token_scopes =
          tokenScopes as ThirdPartyAppUpdate["allowed_token_scopes"]
      }
      if (!sameScopes(apiKeyScopes, app.allowed_api_key_scopes)) {
        requestBody.allowed_api_key_scopes =
          apiKeyScopes as ThirdPartyAppUpdate["allowed_api_key_scopes"]
      }
      return ThirdPartyAppsService.updateThirdPartyApp({
        appId: app.id,
        requestBody,
      })
    },
    onSuccess: () => {
      showSuccessToast("App updated")
      queryClient.invalidateQueries({ queryKey: ["third-party-apps"] })
      onClose()
    },
    onError: createErrorHandler(showErrorToast),
  })

  function toggleScope(
    scope: string,
    current: string[],
    setter: (v: string[]) => void,
  ) {
    setter(
      current.includes(scope)
        ? current.filter((s) => s !== scope)
        : [...current, scope],
    )
    setScopeError("")
  }

  const addedTokenScopes = tokenScopes.filter(
    (s) => !app.allowed_token_scopes.includes(s),
  )
  const addedApiKeyScopes = apiKeyScopes.filter(
    (s) => !app.allowed_api_key_scopes.includes(s),
  )
  const isExpandingScopes =
    addedTokenScopes.length > 0 || addedApiKeyScopes.length > 0

  const hasChanges =
    name.trim() !== app.name ||
    !sameScopes(tokenScopes, app.allowed_token_scopes) ||
    !sameScopes(apiKeyScopes, app.allowed_api_key_scopes)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    let valid = true
    if (!name.trim()) {
      setNameError("Name is required")
      valid = false
    }
    if (tokenScopes.length === 0) {
      setScopeError("Select at least one token scope")
      valid = false
    }
    if (!valid) return
    updateMutation.mutate()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit third-party app</DialogTitle>
            <DialogDescription>
              Update the name or adjust the scopes this app can request. The
              existing key keeps working — rotate separately if you need a new
              one.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-app-name">Name</Label>
              <Input
                id="edit-app-name"
                placeholder="e.g. Acme Integration"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameError("")
                }}
              />
              {nameError && (
                <p className="text-sm text-destructive">{nameError}</p>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <Label>Token scopes</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Scopes the JWT minted by this app can carry.
                </p>
              </div>
              {scopeError && (
                <p className="text-sm text-destructive">{scopeError}</p>
              )}
              <ScopeGroup
                label="Portal"
                scopes={availableScopes.token_scopes}
                selectedScopes={tokenScopes}
                onToggle={(s) => toggleScope(s, tokenScopes, setTokenScopes)}
              />
            </div>

            <div className="space-y-3">
              <div>
                <Label>API key scopes</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Scopes the app is allowed to request when minting API keys.
                </p>
              </div>
              <ScopeGroup
                label="API keys"
                scopes={availableScopes.api_key_scopes}
                selectedScopes={apiKeyScopes}
                onToggle={(s) => toggleScope(s, apiKeyScopes, setApiKeyScopes)}
              />
            </div>

            {(legacyTokenScopes.length > 0 ||
              legacyApiKeyScopes.length > 0) && (
              <div className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning-soft p-3">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">
                    Legacy scopes will be removed on save.
                  </p>
                  {legacyTokenScopes.length > 0 && (
                    <p>Token scopes dropped: {legacyTokenScopes.join(", ")}</p>
                  )}
                  {legacyApiKeyScopes.length > 0 && (
                    <p>
                      API key scopes dropped: {legacyApiKeyScopes.join(", ")}
                    </p>
                  )}
                </div>
              </div>
            )}

            {isExpandingScopes && (
              <div className="flex items-start gap-2 rounded-md border border-warning/25 bg-warning-soft p-3">
                <AlertTriangle className="h-4 w-4 shrink-0 text-warning mt-0.5" />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">
                    You are broadening this app's permissions.
                  </p>
                  {addedTokenScopes.length > 0 && (
                    <p>New token scopes: {addedTokenScopes.join(", ")}</p>
                  )}
                  {addedApiKeyScopes.length > 0 && (
                    <p>New API key scopes: {addedApiKeyScopes.join(", ")}</p>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <LoadingButton
              type="submit"
              loading={updateMutation.isPending}
              disabled={!hasChanges}
            >
              Save changes
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function sameScopes(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const setB = new Set(b)
  return a.every((s) => setB.has(s))
}

function RotateConfirmDialog({
  appName,
  appId,
  onClose,
  onRotated,
}: {
  appName: string
  appId: string
  onClose: () => void
  onRotated: (rawKey: string) => void
}) {
  const { showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()

  const rotateMutation = useMutation({
    mutationFn: () => ThirdPartyAppsService.rotateThirdPartyApp({ appId }),
    onSuccess: (result: ThirdPartyAppCreated) => {
      queryClient.invalidateQueries({ queryKey: ["third-party-apps"] })
      onRotated(result.raw_key)
    },
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rotate app key</DialogTitle>
          <DialogDescription>
            Rotating &ldquo;{appName}&rdquo; will generate a new key. The
            current key stops working immediately. All clients must be updated.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <LoadingButton
            loading={rotateMutation.isPending}
            onClick={() => rotateMutation.mutate()}
          >
            Rotate key
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RevokeConfirmDialog({
  appName,
  appId,
  onClose,
}: {
  appName: string
  appId: string
  onClose: () => void
}) {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()

  const revokeMutation = useMutation({
    mutationFn: () => ThirdPartyAppsService.revokeThirdPartyApp({ appId }),
    onSuccess: () => {
      showSuccessToast("App revoked")
      queryClient.invalidateQueries({ queryKey: ["third-party-apps"] })
      onClose()
    },
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke app</DialogTitle>
          <DialogDescription>
            Revoke &ldquo;{appName}&rdquo;? Existing portal sessions stay valid
            until expiry, but no new logins will be possible with this key. This
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <LoadingButton
            variant="destructive"
            loading={revokeMutation.isPending}
            onClick={() => revokeMutation.mutate()}
          >
            Revoke
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ThirdPartyAppsTable({ onCreateClick }: { onCreateClick: () => void }) {
  const [rawKey, setRawKey] = useState<string | null>(null)
  const [rawKeyTitle, setRawKeyTitle] = useState("")
  const [rotateTarget, setRotateTarget] = useState<ThirdPartyAppPublic | null>(
    null,
  )
  const [revokeTarget, setRevokeTarget] = useState<ThirdPartyAppPublic | null>(
    null,
  )
  const [editTarget, setEditTarget] = useState<ThirdPartyAppPublic | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ["third-party-apps"],
    queryFn: () => ThirdPartyAppsService.listThirdPartyApps(),
  })

  const { data: availableScopes } = useQuery({
    queryKey: ["third-party-apps-available-scopes"],
    queryFn: () => ThirdPartyAppsService.getAvailableScopes(),
    enabled: editTarget !== null,
  })

  const columns: ColumnDef<ThirdPartyAppPublic>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => (
        <div>
          <p className="font-medium">{row.original.name}</p>
          <p className="text-xs text-muted-foreground font-mono">
            {row.original.prefix}...
          </p>
        </div>
      ),
    },
    {
      accessorKey: "allowed_token_scopes",
      header: "Token scopes",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.allowed_token_scopes.slice(0, 2).map((scope) => (
            <Badge key={scope} variant="secondary" className="text-xs">
              {scope}
            </Badge>
          ))}
          {row.original.allowed_token_scopes.length > 2 && (
            <Badge variant="outline" className="text-xs">
              +{row.original.allowed_token_scopes.length - 2} more
            </Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: "allowed_api_key_scopes",
      header: "API key scopes",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.allowed_api_key_scopes.length === 0 ? (
            <span className="text-xs text-muted-foreground">None</span>
          ) : (
            <>
              {row.original.allowed_api_key_scopes.slice(0, 2).map((scope) => (
                <Badge key={scope} variant="outline" className="text-xs">
                  {scope}
                </Badge>
              ))}
              {row.original.allowed_api_key_scopes.length > 2 && (
                <Badge variant="outline" className="text-xs">
                  +{row.original.allowed_api_key_scopes.length - 2} more
                </Badge>
              )}
            </>
          )}
        </div>
      ),
    },
    {
      accessorKey: "last_used_at",
      header: "Last used",
      cell: ({ row }) => (
        <span className="text-sm">{formatDate(row.original.last_used_at)}</span>
      ),
    },
    {
      accessorKey: "revoked_at",
      header: "Status",
      cell: ({ row }) =>
        row.original.revoked_at ? (
          <Badge variant="destructive">Revoked</Badge>
        ) : (
          <Badge variant="secondary">Active</Badge>
        ),
    },
    {
      id: "actions",
      cell: ({ row }) =>
        !row.original.revoked_at ? (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                setEditTarget(row.original)
              }}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                setRotateTarget(row.original)
              }}
            >
              Rotate
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={(e) => {
                e.stopPropagation()
                setRevokeTarget(row.original)
              }}
            >
              Revoke
            </Button>
          </div>
        ) : null,
    },
  ]

  if (isLoading) return <Skeleton className="h-64 w-full" />
  if (!data) return null

  return (
    <>
      <DataTable
        columns={columns}
        data={data.results ?? []}
        emptyState={
          <EmptyState
            icon={Building2}
            title="No third-party apps yet"
            description="Create an app to register an integration."
            action={
              <Button onClick={onCreateClick}>
                <Plus className="mr-2 h-4 w-4" />
                Create new app
              </Button>
            }
          />
        }
      />

      {rotateTarget && (
        <RotateConfirmDialog
          appName={rotateTarget.name}
          appId={rotateTarget.id}
          onClose={() => setRotateTarget(null)}
          onRotated={(key) => {
            setRotateTarget(null)
            setRawKey(key)
            setRawKeyTitle("App key rotated")
          }}
        />
      )}

      {revokeTarget && (
        <RevokeConfirmDialog
          appName={revokeTarget.name}
          appId={revokeTarget.id}
          onClose={() => setRevokeTarget(null)}
        />
      )}

      {editTarget && availableScopes && (
        <EditAppDialog
          app={editTarget}
          availableScopes={availableScopes}
          onClose={() => setEditTarget(null)}
        />
      )}

      {rawKey && (
        <RevealKeyDialog
          rawKey={rawKey}
          title={rawKeyTitle}
          onClose={() => setRawKey(null)}
        />
      )}
    </>
  )
}

function ThirdPartyAppsPage() {
  const { isAdmin } = useAuth()
  const [createOpen, setCreateOpen] = useState(false)
  const [rawKey, setRawKey] = useState<string | null>(null)

  const { data: availableScopes } = useQuery({
    queryKey: ["third-party-apps-available-scopes"],
    queryFn: () => ThirdPartyAppsService.getAvailableScopes(),
    enabled: createOpen,
  })

  if (!isAdmin) {
    return null
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Third-party Apps
          </h1>
          <p className="text-muted-foreground">
            Manage third-party integration credentials for this tenant
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create new app
        </Button>
      </div>

      <QueryErrorBoundary>
        <ThirdPartyAppsTable onCreateClick={() => setCreateOpen(true)} />
      </QueryErrorBoundary>

      {createOpen && availableScopes && (
        <CreateAppDialog
          availableScopes={availableScopes}
          onClose={() => setCreateOpen(false)}
          onCreated={(key) => {
            setCreateOpen(false)
            setRawKey(key)
          }}
        />
      )}

      {rawKey && (
        <RevealKeyDialog
          rawKey={rawKey}
          title="App created"
          onClose={() => setRawKey(null)}
        />
      )}
    </div>
  )
}
