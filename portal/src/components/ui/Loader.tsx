/**
 * Canonical full-screen loader. Every sequential loading gate on first
 * render (route fallback, tenant resolution, checkout runtime, checkout
 * init) renders this same component so the user perceives one continuous
 * loader instead of a chain of different ones.
 */
export function Loader() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background">
      <div className="h-12 w-12 animate-spin rounded-full border-t-2 border-b-2 border-current opacity-60" />
    </div>
  )
}
