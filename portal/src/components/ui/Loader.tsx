/** Nested loading states stay inside the content area, leaving navigation usable. */
export function Loader({ fullscreen = false }: { fullscreen?: boolean }) {
  return (
    <div
      className={
        fullscreen
          ? "fixed inset-0 z-50 flex items-center justify-center bg-background"
          : "flex min-h-48 w-full items-center justify-center p-8"
      }
    >
      <div className="h-12 w-12 animate-spin rounded-full border-t-2 border-b-2 border-current opacity-60" />
    </div>
  )
}
