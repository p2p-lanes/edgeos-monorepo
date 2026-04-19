import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "./dialog"

const Modal = ({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean
  onClose: () => void
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  className?: string
}) => {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className={`rounded-lg p-6 max-w-md ${className}`}>
        <DialogHeader className="text-left pb-0">
          <DialogTitle className="text-lg font-semibold text-foreground leading-none tracking-tight">
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="text-sm text-muted-foreground mt-1.5">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        <div className="py-4">{children}</div>
      </DialogContent>
    </Dialog>
  )
}
export default Modal
