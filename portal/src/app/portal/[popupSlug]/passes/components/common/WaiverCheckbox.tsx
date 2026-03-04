import { Info } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

interface WaiverCheckboxProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  className?: string
}

const WaiverCheckbox = ({
  checked,
  onCheckedChange,
  className,
}: WaiverCheckboxProps) => {
  const { t } = useTranslation()

  return (
    <TooltipProvider>
      <div className={`flex items-start space-x-2 ${className || ""}`}>
        <Checkbox
          id="waiver-agreement"
          checked={checked}
          onCheckedChange={onCheckedChange}
          className="mt-1"
        />
        <div className="flex items-start space-x-2 flex-1">
          <Label
            htmlFor="waiver-agreement"
            className="text-xs text-muted-foreground mt-1 cursor-pointer"
          >
            {t("passes.waiver_acknowledge")}{" "}
            <a
              href="https://waiver.smartwaiver.com/w/bgnpvra597aqdukktfwyss/web/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline font-medium"
            >
              {t("passes.waiver_info")}
            </a>
          </Label>
          <Tooltip>
            <TooltipTrigger asChild>
              <Info
                className="h-4 w-4 text-muted-foreground mt-1 flex-shrink-0"
                tabIndex={0}
                aria-label="Waiver information"
              />
            </TooltipTrigger>
            <TooltipContent
              side="top"
              className="max-w-xs p-3 text-xs leading-relaxed"
            >
              {t("passes.waiver_detail")}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </TooltipProvider>
  )
}

export default WaiverCheckbox
