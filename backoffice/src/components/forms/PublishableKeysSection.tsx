import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Copy, KeyRound, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import {
  type PublishableKeyCreated,
  PublishableKeysService,
} from "@/services/publishableKeys"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { InlineSection } from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

interface PublishableKeysSectionProps {
  tenantId: string
}

/** Split a textarea of origins (comma- or newline-separated) into a clean list. */
function parseOrigins(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((o) => o.trim())
    .filter(Boolean)
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={() => {
        navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
      aria-label="Copy"
    >
      {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
    </Button>
  )
}

export function PublishableKeysSection({
  tenantId,
}: PublishableKeysSectionProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [name, setName] = useState("")
  const [origins, setOrigins] = useState("")
  const [created, setCreated] = useState<PublishableKeyCreated | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)

  const { data: keys, isLoading } = useQuery({
    queryKey: ["publishable-keys", tenantId],
    queryFn: () => PublishableKeysService.listPublishableKeys(),
  })

  const createMutation = useMutation({
    mutationFn: () =>
      PublishableKeysService.createPublishableKey({
        requestBody: {
          name: name.trim(),
          allowed_origins: parseOrigins(origins),
        },
      }),
    onSuccess: (row) => {
      setCreated(row)
      setName("")
      setOrigins("")
      queryClient.invalidateQueries({
        queryKey: ["publishable-keys", tenantId],
      })
      showSuccessToast("Publishable key created")
    },
    onError: createErrorHandler(showErrorToast),
  })

  const revokeMutation = useMutation({
    mutationFn: (keyId: string) =>
      PublishableKeysService.revokePublishableKey({ keyId }),
    onSuccess: () => {
      showSuccessToast("Publishable key revoked")
      setConfirmingId(null)
      queryClient.invalidateQueries({
        queryKey: ["publishable-keys", tenantId],
      })
    },
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <InlineSection title="Checkout SDK Keys">
      <div className="py-3 space-y-3">
        <Alert>
          <AlertDescription>
            Browser-safe <strong>publishable keys</strong> let an
            externally-hosted checkout (built on the EdgeOS checkout SDK)
            consume this organization's gatherings. They are not secret — restrict
            them by listing the exact origins allowed to use them. One key works
            across all of this organization's gatherings.
          </AlertDescription>
        </Alert>

        {/* Reveal-once banner for a freshly created key */}
        {created && (
          <Alert className="border-success/25 bg-success-soft">
            <AlertDescription className="space-y-2">
              <p className="text-sm font-medium text-success">
                Copy your key now — it won't be shown again.
              </p>
              <div className="flex items-center gap-1">
                <Input
                  readOnly
                  value={created.key}
                  className="h-8 w-full font-mono text-xs"
                />
                <CopyButton value={created.key} />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCreated(null)}
              >
                Done
              </Button>
            </AlertDescription>
          </Alert>
        )}

        {/* Create form */}
        <div className="space-y-2 rounded-lg border p-3">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Key name</p>
            <Input
              placeholder="e.g. Acme custom checkout"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-sm"
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              Allowed origins (one per line or comma-separated)
            </p>
            <Textarea
              placeholder={"https://checkout.acme.com\nhttps://www.acme.com"}
              value={origins}
              onChange={(e) => setOrigins(e.target.value)}
              className="min-h-[64px] font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">
              Leave empty to allow any origin (not recommended). Matching is by
              host, so the port is ignored.
            </p>
          </div>
          <LoadingButton
            type="button"
            size="sm"
            loading={createMutation.isPending}
            disabled={!name.trim()}
            onClick={() => createMutation.mutate()}
          >
            <Plus className="mr-2 h-4 w-4" />
            Generate key
          </LoadingButton>
        </div>

        {/* Existing keys */}
        {isLoading ? (
          <Skeleton className="h-16 w-full" />
        ) : keys && keys.length > 0 ? (
          <div className="space-y-2">
            {keys.map((key) => (
              <div
                key={key.id}
                className="flex items-start justify-between gap-3 rounded-lg border p-3"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <KeyRound className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{key.name}</p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {key.key_prefix}…
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {key.allowed_origins.length > 0 ? (
                        key.allowed_origins.map((o) => (
                          <Badge key={o} variant="outline" className="text-[10px]">
                            {o}
                          </Badge>
                        ))
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-[10px] border-warning/25 text-warning"
                        >
                          any origin
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                {confirmingId === key.id ? (
                  <div className="flex shrink-0 items-center gap-1">
                    <LoadingButton
                      type="button"
                      variant="destructive"
                      size="sm"
                      loading={revokeMutation.isPending}
                      onClick={() => revokeMutation.mutate(key.id)}
                    >
                      Confirm
                    </LoadingButton>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmingId(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Revoke ${key.name}`}
                    onClick={() => setConfirmingId(key.id)}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No publishable keys yet.
          </p>
        )}
      </div>
    </InlineSection>
  )
}
