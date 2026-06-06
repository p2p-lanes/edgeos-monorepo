import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Loader2, Trash2, UserPlus } from "lucide-react"
import { useRef, useState } from "react"

import {
  type ApplicationPublic,
  ApplicationsService,
  type GroupMemberPublic,
  GroupsService,
  type GroupWithMembers,
} from "@/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

interface GroupMembersSectionProps {
  group: GroupWithMembers
}

function applicationDisplayName(app: ApplicationPublic): string {
  const h = app.human
  if (!h) return app.id
  const name = [h.first_name, h.last_name].filter(Boolean).join(" ").trim()
  return name || h.email
}

export function GroupMembersSection({ group }: GroupMembersSectionProps) {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()

  const [pickerOpen, setPickerOpen] = useState(false)
  const [search, setSearch] = useState("")
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [debouncedSearch, setDebouncedSearch] = useState("")

  const members: GroupMemberPublic[] = group.members ?? []
  const maxMembers = group.max_members ?? null
  const isFull = maxMembers !== null && members.length >= maxMembers

  // Search accepted applications in this popup
  const { data: appResults, isFetching: appsFetching } = useQuery({
    queryKey: ["group-member-picker", group.popup_id, debouncedSearch],
    queryFn: () =>
      ApplicationsService.listApplications({
        popupId: group.popup_id,
        statusFilter: "accepted",
        search: debouncedSearch || null,
        limit: 20,
      }),
    enabled: pickerOpen,
  })

  const removeMutation = useMutation({
    mutationFn: (humanId: string) =>
      GroupsService.removeGroupMember({ groupId: group.id, humanId }),
    onSuccess: () => {
      showSuccessToast("Member removed")
      queryClient.invalidateQueries({ queryKey: ["groups", group.id] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  const addMutation = useMutation({
    mutationFn: (applicationId: string) =>
      GroupsService.addMemberByApplicationAdmin({
        groupId: group.id,
        requestBody: { application_id: applicationId },
      }),
    onSuccess: () => {
      showSuccessToast("Member added")
      setPickerOpen(false)
      setSearch("")
      setDebouncedSearch("")
      queryClient.invalidateQueries({ queryKey: ["groups", group.id] })
    },
    onError: createErrorHandler(showErrorToast),
  })

  function handleSearchChange(value: string) {
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 300)
  }

  // Filter out applications whose human is already a member
  const memberHumanIds = new Set(members.map((m) => m.id))
  const candidates =
    appResults?.results?.filter(
      (app) => app.human_id && !memberHumanIds.has(app.human_id),
    ) ?? []

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Separator />
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Members
          </p>
          <p className="text-xs text-muted-foreground">
            {maxMembers !== null
              ? `${members.length} / ${maxMembers}`
              : `${members.length} member${members.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <Popover
          open={pickerOpen}
          onOpenChange={(open) => {
            setPickerOpen(open)
            if (!open) {
              setSearch("")
              setDebouncedSearch("")
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isFull}
              title={
                isFull
                  ? "Group has reached its maximum member limit"
                  : undefined
              }
            >
              <UserPlus className="mr-1.5 h-4 w-4" />
              Add member
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="border-b p-2">
              <Input
                autoFocus
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Search accepted applications"
                className="h-8"
              />
            </div>
            <div className="max-h-64 overflow-y-auto py-1">
              {appsFetching ? (
                <div className="flex items-center justify-center py-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : candidates.length > 0 ? (
                candidates.map((app) => {
                  const name = applicationDisplayName(app)
                  const email = app.human?.email ?? ""
                  return (
                    <button
                      key={app.id}
                      type="button"
                      className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                      disabled={addMutation.isPending}
                      onClick={() => addMutation.mutate(app.id)}
                    >
                      <span className="font-medium">{name}</span>
                      {email && email !== name && (
                        <span className="text-xs text-muted-foreground">
                          {email}
                        </span>
                      )}
                    </button>
                  )
                })
              ) : (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">
                  {debouncedSearch
                    ? "No matches"
                    : "Type to search accepted applications"}
                </p>
              )}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {members.length === 0 ? (
        <p className="text-sm text-muted-foreground">No members yet.</p>
      ) : (
        <div className="divide-y rounded-md border">
          {members.map((member) => {
            const name = [member.first_name, member.last_name]
              .filter(Boolean)
              .join(" ")
              .trim()
            return (
              <div
                key={member.id}
                className="flex items-center justify-between px-4 py-2.5"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {name || member.email}
                  </p>
                  {name && (
                    <p className="truncate text-xs text-muted-foreground">
                      {member.email}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                  disabled={removeMutation.isPending}
                  onClick={() => removeMutation.mutate(member.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
