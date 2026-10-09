import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export interface SSOUrls {
  start: string
  callback: string
}

export function ThirdPartySSOFields({
  value,
  onChange,
  id,
}: {
  value: SSOUrls
  onChange: (value: SSOUrls) => void
  id: string
}) {
  return (
    <div className="space-y-3 border-t pt-4">
      <div>
        <Label>Portal SSO (optional)</Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Set both URLs to allow automatic access from custom homes. Clear both
          to disable SSO. HTTPS required, except localhost in development.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-start`}>App start URL</Label>
        <Input
          id={`${id}-start`}
          type="url"
          placeholder="https://app.example/auth/start"
          value={value.start}
          onChange={(e) => onChange({ ...value, start: e.target.value })}
        />
        <p className="text-xs text-muted-foreground">
          Receives authorize_url; the app prepares state and PKCE before
          returning to the portal.
        </p>
      </div>
      <div className="space-y-2">
        <Label htmlFor={`${id}-callback`}>Exact callback URL</Label>
        <Input
          id={`${id}-callback`}
          type="url"
          placeholder="https://app.example/auth/callback"
          value={value.callback}
          onChange={(e) => onChange({ ...value, callback: e.target.value })}
        />
      </div>
    </div>
  )
}
