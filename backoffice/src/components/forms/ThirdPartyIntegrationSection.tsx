import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangle,
  Check,
  Copy,
  Link2,
  RefreshCw,
  Unlink,
} from "lucide-react"
import { useState } from "react"

import { TenantsService, type ThirdPartyKeyRotated } from "@/client"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { InlineRow, InlineSection } from "@/components/ui/inline-form"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

interface ThirdPartyIntegrationSectionProps {
  tenantId: string
  /** Prefix is null when third-party integration is not yet configured */
  prefix: string | null | undefined
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
  result,
  onClose,
}: {
  result: ThirdPartyKeyRotated
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Third-party API key generated</DialogTitle>
          <DialogDescription>
            Save this key now. You will not be able to see it again.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-md border bg-muted p-3">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-500" />
            <p className="text-xs text-muted-foreground">
              Distribute this key to your third-party integration partner.
              Anyone with this key can initiate OTP logins for your portal
              users. Store it securely and rotate it if it is ever compromised.
            </p>
          </div>
          <div className="rounded-md border bg-background p-3 font-mono text-sm break-all select-all">
            {result.api_key}
          </div>
          <CopyButton value={result.api_key} />
        </div>
        <DialogFooter>
          <Button onClick={onClose}>I have saved it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function RotateConfirmDialog({
  onConfirm,
  onClose,
  isPending,
}: {
  onConfirm: () => void
  onClose: () => void
  isPending: boolean
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rotate third-party API key</DialogTitle>
          <DialogDescription>
            A new key will be generated and the current key will stop working
            immediately. All third-party clients must be updated to use the new
            key.
          </DialogDescription>
        </DialogHeader>
        <Alert>
          <AlertDescription>
            In-flight portal sessions that were authenticated before rotation
            will remain valid until their tokens expire naturally.
          </AlertDescription>
        </Alert>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <LoadingButton loading={isPending} onClick={onConfirm}>
            Rotate key
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DisableConfirmDialog({
  onConfirm,
  onClose,
  isPending,
}: {
  onConfirm: () => void
  onClose: () => void
  isPending: boolean
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disable third-party login</DialogTitle>
          <DialogDescription>
            Third-party OTP login will be disabled for all users in this tenant.
            Existing portal sessions remain valid until they expire.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <LoadingButton
            variant="destructive"
            loading={isPending}
            onClick={onConfirm}
          >
            Disable
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ThirdPartyIntegrationSection({
  tenantId,
  prefix,
}: ThirdPartyIntegrationSectionProps) {
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const queryClient = useQueryClient()

  const [rotateDialogOpen, setRotateDialogOpen] = useState(false)
  const [disableDialogOpen, setDisableDialogOpen] = useState(false)
  const [revealResult, setRevealResult] = useState<ThirdPartyKeyRotated | null>(
    null,
  )

  const rotateMutation = useMutation({
    mutationFn: () => TenantsService.rotateThirdPartyKey({ tenantId }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["tenants", tenantId] })
      setRotateDialogOpen(false)
      setRevealResult(result)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const deleteMutation = useMutation({
    mutationFn: () => TenantsService.deleteThirdPartyKey({ tenantId }),
    onSuccess: () => {
      showSuccessToast("Third-party login disabled")
      queryClient.invalidateQueries({ queryKey: ["tenants", tenantId] })
      setDisableDialogOpen(false)
    },
    onError: createErrorHandler(showErrorToast),
  })

  const isEnabled = !!prefix

  return (
    <>
      <InlineSection title="Third-party integration">
        <InlineRow
          icon={<Link2 className="h-4 w-4 text-muted-foreground" />}
          label="Third-party OTP login"
          description={
            isEnabled
              ? `Enabled - prefix: ${prefix}`
              : "Disabled - generate a key to enable"
          }
        >
          {isEnabled ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRotateDialogOpen(true)}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Rotate key
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={() => setDisableDialogOpen(true)}
              >
                <Unlink className="mr-2 h-4 w-4" />
                Disable
              </Button>
            </div>
          ) : (
            <LoadingButton
              type="button"
              variant="outline"
              size="sm"
              loading={rotateMutation.isPending}
              onClick={() => rotateMutation.mutate()}
            >
              Generate API key
            </LoadingButton>
          )}
        </InlineRow>
      </InlineSection>

      {rotateDialogOpen && (
        <RotateConfirmDialog
          onConfirm={() => rotateMutation.mutate()}
          onClose={() => setRotateDialogOpen(false)}
          isPending={rotateMutation.isPending}
        />
      )}

      {disableDialogOpen && (
        <DisableConfirmDialog
          onConfirm={() => deleteMutation.mutate()}
          onClose={() => setDisableDialogOpen(false)}
          isPending={deleteMutation.isPending}
        />
      )}

      {revealResult && (
        <RevealKeyDialog
          result={revealResult}
          onClose={() => setRevealResult(null)}
        />
      )}
    </>
  )
}
