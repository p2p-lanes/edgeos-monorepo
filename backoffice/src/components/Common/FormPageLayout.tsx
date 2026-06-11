import { ArrowLeft } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useGoBack } from "@/hooks/useGoBack"

interface FormPageLayoutProps {
  title: string
  description: string
  backTo: string
  onBack?: () => void
  /** Optional header actions rendered on the right of the title row. */
  actions?: React.ReactNode
  children: React.ReactNode
}

export function FormPageLayout({
  title,
  description,
  backTo,
  onBack,
  actions,
  children,
}: FormPageLayoutProps) {
  const goBack = useGoBack({ to: backTo })

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Go back"
          onClick={onBack ?? goBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          <p className="text-muted-foreground">{description}</p>
        </div>
        {actions && (
          <div className="ml-auto flex items-center gap-2">{actions}</div>
        )}
      </div>
      {children}
    </div>
  )
}
