import type React from "react"
import { toast } from "sonner"

interface ToastAction {
  label: string
  onClick: () => void
}

const useCustomToast = () => {
  const showSuccessToast = (description: string, action?: ToastAction) => {
    toast.success("Success!", {
      description,
      ...(action && {
        action: { label: action.label, onClick: action.onClick },
      }),
    })
  }

  const showErrorToast = (description: string) => {
    toast.error("Something went wrong!", {
      description,
    })
  }

  const showWarningToast = (title: string, description?: React.ReactNode) => {
    toast.warning(title, { description })
  }

  return { showSuccessToast, showErrorToast, showWarningToast }
}

export default useCustomToast
