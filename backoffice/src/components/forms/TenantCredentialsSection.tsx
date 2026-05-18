import { useQuery } from "@tanstack/react-query"
import {
  Check,
  Copy,
  Database,
  Eye,
  EyeOff,
  KeyRound,
  ShieldCheck,
} from "lucide-react"
import { useState } from "react"

import { type CredentialInfo, TenantsService } from "@/client"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { InlineRow, InlineSection } from "@/components/ui/inline-form"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"

interface TenantCredentialsSectionProps {
  tenantId: string
}

const CREDENTIAL_META: Record<
  CredentialInfo["credential_type"],
  { label: string; description: string; Icon: typeof KeyRound }
> = {
  crud: {
    label: "CRUD (read/write)",
    description: "Used by admin sessions. Row-level scoped to this tenant.",
    Icon: KeyRound,
  },
  readonly: {
    label: "Read-only",
    description: "Used by viewer sessions. SELECT-only, scoped to this tenant.",
    Icon: ShieldCheck,
  },
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

function ReadOnlyField({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-1">
      <Input readOnly value={value} className="h-8 w-full font-mono text-xs" />
      <CopyButton value={value} />
    </div>
  )
}

function SecretField({ value }: { value: string }) {
  const [show, setShow] = useState(false)
  return (
    <div className="flex items-center gap-1">
      <Input
        readOnly
        type={show ? "text" : "password"}
        value={value}
        className="h-8 w-full font-mono text-xs"
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={() => setShow((s) => !s)}
        aria-label={show ? "Hide password" : "Show password"}
      >
        {show ? (
          <EyeOff className="h-4 w-4 text-muted-foreground" />
        ) : (
          <Eye className="h-4 w-4 text-muted-foreground" />
        )}
      </Button>
      <CopyButton value={value} />
    </div>
  )
}

export function TenantCredentialsSection({
  tenantId,
}: TenantCredentialsSectionProps) {
  const [revealed, setRevealed] = useState(false)
  const { data, isFetching, error } = useQuery({
    queryKey: ["tenants", tenantId, "credentials"],
    queryFn: () => TenantsService.getCredentials({ tenantId }),
    enabled: revealed,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  })

  return (
    <InlineSection title="Database Credentials">
      <div className="py-3">
        <Alert>
          <AlertDescription>
            Direct database credentials for this tenant. Use only for support,
            migrations, or audits.
          </AlertDescription>
        </Alert>
      </div>

      {!revealed && (
        <div className="py-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => setRevealed(true)}
          >
            <Eye className="mr-2 h-4 w-4" />
            Reveal credentials
          </Button>
        </div>
      )}

      {revealed && isFetching && (
        <div className="py-3">
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {revealed && !isFetching && error && (
        <div className="py-3">
          <Alert variant="destructive">
            <AlertDescription>
              No credentials configured for this tenant yet. Credentials are
              generated on first tenant connection.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {revealed && data && (
        <>
          <InlineRow
            icon={<Database className="h-4 w-4 text-muted-foreground" />}
            label="Host"
            description={`Port ${data.db_port} · Database ${data.db_name}`}
          >
            <div className="w-72">
              <ReadOnlyField value={data.db_host} />
            </div>
          </InlineRow>

          {data.credentials.map((cred) => {
            const meta = CREDENTIAL_META[cred.credential_type]
            const Icon = meta.Icon
            return (
              <div key={cred.credential_type} className="space-y-3 py-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                    <Icon className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium">{meta.label}</p>
                      <Badge variant="outline" className="text-xs">
                        {cred.credential_type}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {meta.description}
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 pl-11 sm:grid-cols-2">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Username</p>
                    <ReadOnlyField value={cred.db_username} />
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Password</p>
                    <SecretField value={cred.db_password} />
                  </div>
                </div>
              </div>
            )
          })}
        </>
      )}
    </InlineSection>
  )
}
