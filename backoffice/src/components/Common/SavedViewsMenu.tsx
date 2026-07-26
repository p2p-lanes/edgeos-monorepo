import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Bookmark, BookmarkPlus, Trash2 } from "lucide-react"
import { useState } from "react"

import {
  type ApiError,
  type SavedViewPublic,
  SavedViewsService,
} from "@/client"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
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
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import useAuth from "@/hooks/useAuth"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

function savedViewsQueryKey(popupId: string, entity: string) {
  return ["saved-views", popupId, entity]
}

/**
 * Team-shared saved views for a list page: apply, save the current
 * configuration under a name, or delete.
 */
export function SavedViewsMenu({
  popupId,
  entity,
  currentConfig,
  onApply,
}: {
  popupId: string
  entity: string
  currentConfig: Record<string, unknown>
  onApply: (config: Record<string, unknown>) => void
}) {
  const queryClient = useQueryClient()
  const { user, isAdmin } = useAuth()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const [open, setOpen] = useState(false)
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [name, setName] = useState("")

  const { data } = useQuery({
    queryKey: savedViewsQueryKey(popupId, entity),
    queryFn: () => SavedViewsService.listSavedViews({ popupId, entity }),
  })
  const views = data?.results ?? []

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: savedViewsQueryKey(popupId, entity),
    })

  const createMutation = useMutation({
    mutationFn: (viewName: string) =>
      SavedViewsService.createSavedView({
        requestBody: {
          popup_id: popupId,
          entity,
          name: viewName,
          config: currentConfig,
        },
      }),
    onSuccess: () => {
      showSuccessToast("View saved")
      setSaveDialogOpen(false)
      setName("")
      invalidate()
    },
    onError: (err) => createErrorHandler(showErrorToast)(err as ApiError),
  })

  const deleteMutation = useMutation({
    mutationFn: (viewId: string) =>
      SavedViewsService.deleteSavedView({ viewId }),
    onSuccess: () => {
      showSuccessToast("View deleted")
      invalidate()
    },
    onError: (err) => createErrorHandler(showErrorToast)(err as ApiError),
  })

  const handleDelete = (view: SavedViewPublic) => {
    const isOwn = !!user && view.created_by === user.id
    // Deleting a teammate's view is a moderation action — confirm so it
    // isn't a stray click. Deleting your own stays one click.
    if (!isOwn && !window.confirm(`Delete the view "${view.name}"?`)) return
    deleteMutation.mutate(view.id)
  }

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || createMutation.isPending) return
    createMutation.mutate(trimmed)
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="h-9">
            <Bookmark className="mr-2 h-4 w-4" />
            Views
            {views.length > 0 && (
              <span className="ml-1.5 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 text-xs font-medium text-primary tabular-nums">
                {views.length}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-2">
          {views.length === 0 ? (
            <p className="px-2 py-1.5 text-sm text-muted-foreground">
              No saved views yet.
            </p>
          ) : (
            <div className="flex max-h-64 flex-col gap-0.5 overflow-y-auto">
              {views.map((view) => {
                const canDelete =
                  isAdmin || (!!user && view.created_by === user.id)
                return (
                  <div
                    key={view.id}
                    className="group flex items-center gap-1 rounded-sm hover:bg-muted"
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate px-2 py-1.5 text-left text-sm"
                      onClick={() => {
                        onApply(view.config)
                        setOpen(false)
                      }}
                    >
                      {view.name}
                    </button>
                    {canDelete && (
                      <button
                        type="button"
                        aria-label={`Delete view ${view.name}`}
                        className="mr-1 rounded-sm p-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
                        disabled={deleteMutation.isPending}
                        onClick={() => handleDelete(view)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          <div className="mt-2 border-t pt-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              onClick={() => {
                setOpen(false)
                setSaveDialogOpen(true)
              }}
            >
              <BookmarkPlus className="mr-2 h-4 w-4" />
              Save current view
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      <Dialog open={saveDialogOpen} onOpenChange={setSaveDialogOpen}>
        <DialogContent>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Save current view</DialogTitle>
              <DialogDescription>
                Saves the current filters, grouping and sorting so the whole
                team can reuse them.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <Label htmlFor="saved-view-name">Name</Label>
              <Input
                id="saved-view-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Pending scholarships"
                autoFocus
              />
            </div>
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </DialogClose>
              <LoadingButton
                type="submit"
                loading={createMutation.isPending}
                disabled={!name.trim()}
              >
                Save view
              </LoadingButton>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
