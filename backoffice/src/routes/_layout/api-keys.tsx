import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import type { ColumnDef } from "@tanstack/react-table"
import { AlertTriangle, Check, Copy, KeyRound, Plus } from "lucide-react"
import { useState } from "react"

import {
  type AdminApiKeyCreate,
  type AdminApiKeyPublic,
  AdminApiKeysService,
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

// Kept in sync with ADMIN_API_KEY_SCOPES in backend core/security.py
const ADMIN_API_KEY_SCOPES = [
  "events:read",
  "events:write",
  "rsvp:write",
  "venues:write",
  "applications:read",
  "applications:write",
  "attendees:read",
  "attendees:write",
  "humans:read",
  "humans:write",
  "groups:read",
  "groups:write",
  "products:read",
  "products:write",
  "coupons:read",
  "coupons:write",
  "forms:read",
  "forms:write",
  "payments:read",
  "tracks:read",
  "tracks:write",
  "ticketing_steps:read",
  "ticketing_steps:write",
  "translations:read",
  "translations:write",
] as const

type AdminApiKeyScope = (typeof ADMIN_API_KEY_SCOPES)[number]

const SCOPE_GROUPS: { label: string; scopes: AdminApiKeyScope[] }[] = [
  {
    label: "Events",
    scopes: ["events:read", "events:write", "rsvp:write", "venues:write"],
  },
  {
    label: "Applications",
    scopes: ["applications:read", "applications:write"],
  },
  {
    label: "People",
    scopes: [
      "attendees:read",
      "attendees:write",
      "humans:read",
      "humans:write",
      "groups:read",
      "groups:write",
    ],
  },
  {
    label: "Catalog",
    scopes: [
      "products:read",
      "products:write",
      "coupons:read",
      "coupons:write",
      "forms:read",
      "forms:write",
    ],
  },
  { label: "Financial", scopes: ["payments:read"] },
  {
    label: "Structure",
    scopes: [
      "tracks:read",
      "tracks:write",
      "ticketing_steps:read",
      "ticketing_steps:write",
      "translations:read",
      "translations:write",
    ],
  },
]

export const Route = createFileRoute("/_layout/api-keys")({
  component: ApiKeysPage,
  head: () => ({
    meta: [{ title: "API Keys - EdgeOS" }],
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
  onClose,
}: {
  rawKey: string
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>API key created</DialogTitle>
          <DialogDescription>
            Save this key now. You will not be able to see it again.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
            <p className="text-xs text-muted-foreground">
              Copy the key below and store it securely. Once you close this
              dialog, the key is gone from this interface.
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

function CreateKeyDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (rawKey: string) => void
}) {
  const { showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()

  const [name, setName] = useState("")
  const [selectedScopes, setSelectedScopes] = useState<AdminApiKeyScope[]>([])
  const [expiresAt, setExpiresAt] = useState("")
  const [nameError, setNameError] = useState("")
  const [scopeError, setScopeError] = useState("")
  const [expiresError, setExpiresError] = useState("")

  const hasWriteScope = selectedScopes.some((s) => s.endsWith(":write"))

  const createMutation = useMutation({
    mutationFn: (data: AdminApiKeyCreate) =>
      AdminApiKeysService.createAdminApiKey({ requestBody: data }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["admin-api-keys"] })
      onCreated(result.raw_key)
    },
    onError: createErrorHandler(showErrorToast),
  })

  function toggleScope(scope: AdminApiKeyScope) {
    setSelectedScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope],
    )
    setScopeError("")
    setExpiresError("")
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    let valid = true
    if (!name.trim()) {
      setNameError("Name is required")
      valid = false
    }
    if (selectedScopes.length === 0) {
      setScopeError("Select at least one scope")
      valid = false
    }
    if (hasWriteScope && !expiresAt) {
      setExpiresError(
        "Expiry date is required when any write scope is selected",
      )
      valid = false
    }
    if (!valid) return

    createMutation.mutate({
      name: name.trim(),
      scopes: selectedScopes,
      expires_at: expiresAt || null,
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Admin API keys let external services call the backoffice API on
              behalf of this admin account.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 py-4">
            <div className="space-y-2">
              <Label htmlFor="api-key-name">Name</Label>
              <Input
                id="api-key-name"
                placeholder="e.g. CI pipeline"
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

            <div className="space-y-2">
              <Label>Scopes</Label>
              <p className="text-xs text-muted-foreground">
                Select the permissions this key should have.
              </p>
              {scopeError && (
                <p className="text-sm text-destructive">{scopeError}</p>
              )}
              <div className="space-y-4">
                {SCOPE_GROUPS.map((group) => (
                  <div key={group.label} className="space-y-2">
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {group.label}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {group.scopes.map((scope) => {
                        const isSelected = selectedScopes.includes(scope)
                        return (
                          <button
                            key={scope}
                            type="button"
                            onClick={() => toggleScope(scope)}
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
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="api-key-expires">
                Expires at
                {hasWriteScope && (
                  <span className="ml-1 text-destructive">*</span>
                )}
              </Label>
              {hasWriteScope && (
                <p className="text-xs text-muted-foreground">
                  Required when any write scope is selected.
                </p>
              )}
              <Input
                id="api-key-expires"
                type="date"
                value={expiresAt}
                min={new Date().toISOString().split("T")[0]}
                onChange={(e) => {
                  setExpiresAt(e.target.value)
                  setExpiresError("")
                }}
              />
              {expiresError && (
                <p className="text-sm text-destructive">{expiresError}</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <LoadingButton type="submit" loading={createMutation.isPending}>
              Create key
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RevokeKeyDialog({
  keyId,
  keyName,
  onClose,
}: {
  keyId: string
  keyName: string
  onClose: () => void
}) {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()

  const revokeMutation = useMutation({
    mutationFn: () => AdminApiKeysService.revokeAdminApiKey({ keyId }),
    onSuccess: () => {
      showSuccessToast("API key revoked")
      queryClient.invalidateQueries({ queryKey: ["admin-api-keys"] })
      onClose()
    },
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke API key</DialogTitle>
          <DialogDescription>
            Revoke &ldquo;{keyName}&rdquo;? Any service using this key will stop
            working immediately. This cannot be undone.
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
            Revoke key
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ApiKeysTable() {
  const [createOpen, setCreateOpen] = useState(false)
  const [rawKey, setRawKey] = useState<string | null>(null)
  const [revokeTarget, setRevokeTarget] = useState<AdminApiKeyPublic | null>(
    null,
  )

  const { data: keys, isLoading } = useQuery({
    queryKey: ["admin-api-keys"],
    queryFn: () => AdminApiKeysService.listAdminApiKeys(),
  })

  const columns: ColumnDef<AdminApiKeyPublic>[] = [
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
      accessorKey: "scopes",
      header: "Scopes",
      cell: ({ row }) => (
        <div className="flex flex-wrap gap-1">
          {row.original.scopes.slice(0, 3).map((scope) => (
            <Badge key={scope} variant="secondary" className="text-xs">
              {scope}
            </Badge>
          ))}
          {row.original.scopes.length > 3 && (
            <Badge variant="outline" className="text-xs">
              +{row.original.scopes.length - 3} more
            </Badge>
          )}
        </div>
      ),
    },
    {
      accessorKey: "expires_at",
      header: "Expires",
      cell: ({ row }) => (
        <span className="text-sm">{formatDate(row.original.expires_at)}</span>
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
        ) : null,
    },
  ]

  if (isLoading) return <Skeleton className="h-64 w-full" />
  if (!keys) return null

  return (
    <>
      <DataTable
        columns={columns}
        data={keys}
        emptyState={
          <EmptyState
            icon={KeyRound}
            title="No API keys yet"
            description="Create an API key to get started."
            action={
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                Create new key
              </Button>
            }
          />
        }
      />

      {createOpen && (
        <CreateKeyDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(key) => {
            setCreateOpen(false)
            setRawKey(key)
          }}
        />
      )}

      {rawKey && (
        <RevealKeyDialog rawKey={rawKey} onClose={() => setRawKey(null)} />
      )}

      {revokeTarget && (
        <RevokeKeyDialog
          keyId={revokeTarget.id}
          keyName={revokeTarget.name}
          onClose={() => setRevokeTarget(null)}
        />
      )}
    </>
  )
}

function ApiKeysPage() {
  const { isAdmin } = useAuth()
  const [createOpen, setCreateOpen] = useState(false)
  const [rawKey, setRawKey] = useState<string | null>(null)

  if (!isAdmin) {
    return null
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">API Keys</h1>
          <p className="text-muted-foreground">
            Manage admin API keys for programmatic backoffice access
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Create new key
        </Button>
      </div>

      <QueryErrorBoundary>
        <ApiKeysTable />
      </QueryErrorBoundary>

      {createOpen && (
        <CreateKeyDialog
          onClose={() => setCreateOpen(false)}
          onCreated={(key) => {
            setCreateOpen(false)
            setRawKey(key)
          }}
        />
      )}

      {rawKey && (
        <RevealKeyDialog rawKey={rawKey} onClose={() => setRawKey(null)} />
      )}
    </div>
  )
}
