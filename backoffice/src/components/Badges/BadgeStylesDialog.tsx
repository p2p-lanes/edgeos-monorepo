import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Plus, Star, Trash2 } from "lucide-react"
import { useState } from "react"

import { type BadgeStylePublic, BadgesService } from "@/client"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { LoadingButton } from "@/components/ui/loading-button"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

export const badgeStylesQueryKey = ["badge-styles"]

export function useBadgeStyles() {
  return useQuery({
    queryKey: badgeStylesQueryKey,
    queryFn: () => BadgesService.listBadgeStyles(),
  })
}

function StyleRow({ style }: { style: BadgeStylePublic }) {
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const [name, setName] = useState(style.name)

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: badgeStylesQueryKey })
    // The resolved artwork of every badge depends on the default style.
    queryClient.invalidateQueries({ queryKey: ["badges"] })
  }

  const rename = useMutation({
    mutationFn: () =>
      BadgesService.updateBadgeStyle({
        styleId: style.id,
        requestBody: { name },
      }),
    onSuccess: invalidate,
    onError: createErrorHandler(showErrorToast),
  })
  const makeDefault = useMutation({
    mutationFn: () => BadgesService.setDefaultBadgeStyle({ styleId: style.id }),
    onSuccess: invalidate,
    onError: createErrorHandler(showErrorToast),
  })
  const remove = useMutation({
    mutationFn: () => BadgesService.deleteBadgeStyle({ styleId: style.id }),
    onSuccess: invalidate,
    onError: createErrorHandler(showErrorToast),
  })

  const renamed = name.trim() !== "" && name.trim() !== style.name

  return (
    <div className="flex items-center gap-2">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="h-9"
        aria-label="Style name"
      />
      {renamed && (
        <LoadingButton
          size="icon"
          variant="outline"
          loading={rename.isPending}
          onClick={() => rename.mutate()}
          aria-label="Save name"
        >
          <Check className="h-4 w-4" />
        </LoadingButton>
      )}
      {style.is_default ? (
        <Badge variant="secondary" className="shrink-0">
          Default
        </Badge>
      ) : (
        <>
          <LoadingButton
            size="icon"
            variant="ghost"
            loading={makeDefault.isPending}
            onClick={() => makeDefault.mutate()}
            aria-label="Make default"
            title="Make default"
          >
            <Star className="h-4 w-4" />
          </LoadingButton>
          <LoadingButton
            size="icon"
            variant="ghost"
            loading={remove.isPending}
            onClick={() => {
              if (
                window.confirm(
                  `Delete the "${style.name}" style and every image in it?`,
                )
              ) {
                remove.mutate()
              }
            }}
            aria-label="Delete style"
            title="Delete style"
          >
            <Trash2 className="h-4 w-4" />
          </LoadingButton>
        </>
      )}
    </div>
  )
}

/** Image sets of the badge collection, plus which one is the default. */
export function BadgeStylesDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const { showErrorToast } = useCustomToast()
  const { data: styles = [] } = useBadgeStyles()
  const [newName, setNewName] = useState("")

  const create = useMutation({
    mutationFn: () =>
      BadgesService.createBadgeStyle({
        requestBody: { name: newName.trim(), sort_order: styles.length },
      }),
    onSuccess: () => {
      setNewName("")
      queryClient.invalidateQueries({ queryKey: badgeStylesQueryKey })
    },
    onError: createErrorHandler(showErrorToast),
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Badge styles</DialogTitle>
          <DialogDescription>
            Each style is a full set of artwork. Badges use the default style
            unless they pick another one.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {styles.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No styles yet. The first one you add becomes the default.
            </p>
          )}
          {styles.map((style) => (
            <StyleRow key={`${style.id}-${style.name}`} style={style} />
          ))}
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (newName.trim()) create.mutate()
          }}
        >
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New style, e.g. Luminous glass"
            className="h-9"
          />
          <LoadingButton
            type="submit"
            variant="outline"
            loading={create.isPending}
            disabled={!newName.trim()}
          >
            <Plus className="mr-1 h-4 w-4" />
            Add
          </LoadingButton>
        </form>

        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
