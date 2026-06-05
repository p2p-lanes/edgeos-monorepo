import { useMutation, useQueryClient } from "@tanstack/react-query"

import { TasksService } from "@/client"
import useCustomToast from "@/hooks/useCustomToast"
import { createErrorHandler } from "@/utils"

/**
 * Archive mutations shared by the board, cards, list rows and the task dialog.
 * All invalidate the whole ``["tasks"]`` family so the active board and the
 * Archived tab both refresh.
 */
export function useTaskArchive() {
  const queryClient = useQueryClient()
  const { showSuccessToast, showErrorToast } = useCustomToast()
  const onError = createErrorHandler(showErrorToast)
  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["tasks"] })

  const archive = useMutation({
    mutationFn: (taskId: string) => TasksService.archiveTask({ taskId }),
    onSuccess: () => {
      showSuccessToast("Task archived")
      invalidate()
    },
    onError,
  })

  const unarchive = useMutation({
    mutationFn: (taskId: string) => TasksService.unarchiveTask({ taskId }),
    onSuccess: () => {
      showSuccessToast("Task unarchived")
      invalidate()
    },
    onError,
  })

  const archivePublished = useMutation({
    mutationFn: () => TasksService.archivePublishedTasks(),
    onSuccess: (res) => {
      const n = res.archived
      showSuccessToast(
        n === 0
          ? "No published tasks to archive"
          : `Archived ${n} published task${n === 1 ? "" : "s"}`,
      )
      invalidate()
    },
    onError,
  })

  return { archive, unarchive, archivePublished }
}
