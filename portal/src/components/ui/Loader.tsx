/** Content-local by default; root bootstrap gates opt into a viewport overlay. */
export function Loader({ fullScreen = false }: { fullScreen?: boolean }) {
  return (
    <div
      className={`flex items-center justify-center bg-background ${
        fullScreen ? "fixed inset-0 z-50" : "h-full min-h-[50vh] w-full"
      }`}
    >
      <div className="h-12 w-12 animate-spin rounded-full border-t-2 border-b-2 border-current opacity-60" />
    </div>
  )
}
