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
    description:
      "Used by admin sessions. Row-level scoped to this organization.",
    Icon: KeyRound,
  },
  readonly: {
    label: "Read-only",
    description:
      "Used by viewer sessions. SELECT-only, scoped to this organization.",
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

function buildReadonlyConnectionString(
  _tenantId: string,
  cred: CredentialInfo,
  db: { db_host: string; db_port: number; db_name: string },
) {
  const user = encodeURIComponent(cred.db_username)
  const password = encodeURIComponent(cred.db_password)
  return `postgresql://${user}:${password}@${db.db_host}:${db.db_port}/${db.db_name}`
}

function CopyConnectionStringButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => {
        navigator.clipboard.writeText(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      }}
    >
      {copied ? (
        <Check className="mr-2 h-4 w-4" />
      ) : (
        <Copy className="mr-2 h-4 w-4" />
      )}
      {copied ? "Copied" : "Copy MCP connection string"}
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
            Direct database credentials for this organization. Use only for
            support, migrations, or audits.
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
              No credentials configured for this organization yet. Credentials
              are generated on first connection.
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
                {cred.credential_type === "readonly" && (
                  <div className="space-y-1 pl-11">
                    <CopyConnectionStringButton
                      value={buildReadonlyConnectionString(
                        tenantId,
                        cred,
                        data,
                      )}
                    />
                    <p className="text-xs text-muted-foreground">
                      Read-only PostgreSQL URL scoped to this organization.
                      Scope is enforced by the database, so the holder of this
                      URL cannot read other organizations' data. Append{" "}
                      <code className="rounded bg-muted px-1 py-0.5 text-[10px] font-mono">
                        ?sslmode=require
                      </code>{" "}
                      if your environment requires TLS.
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </>
      )}
    </InlineSection>
  )
}
