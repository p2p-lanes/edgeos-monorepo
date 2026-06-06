import { Link2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard"
import useCustomToast from "@/hooks/useCustomToast"

interface CopyLinkButtonProps {
  url: string | null
  /** When true the button renders inline (ghost/icon). When false it renders as a labeled button. */
  iconOnly?: boolean
}

export function CopyLinkButton({ url, iconOnly = true }: CopyLinkButtonProps) {
  const [, copy] = useCopyToClipboard()
  const { showSuccessToast } = useCustomToast()

  const handleClick = async () => {
    if (!url) return
    const ok = await copy(url)
    if (ok) {
      showSuccessToast("Link copied to clipboard")
    }
  }

  if (iconOnly) {
    return (
      <Button
        variant="ghost"
        size="icon"
        aria-label="Copy link"
        disabled={!url}
        onClick={handleClick}
      >
        <Link2 className="h-4 w-4" />
      </Button>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      aria-label="Copy link"
      disabled={!url}
      onClick={handleClick}
    >
      <Link2 className="mr-2 h-4 w-4" />
      Copy link
    </Button>
  )
}
