/**
 * Amanita skin — twinkling star field for dark backgrounds (decorative).
 *
 * Ported verbatim from checkout-amanita/codigo/compartidos/Stars.tsx. The
 * `amTwinkle` keyframe was renamed to `amanita-amTwinkle` in
 * amanita-skin.css (Task 3) to keep it scoped/collision-free with other
 * skins' global keyframe namespace.
 */
export function Stars({ dim = false }: { dim?: boolean }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{
        opacity: dim ? 0.5 : 1,
        backgroundImage:
          "radial-gradient(circle at 18% 26%,rgba(241,235,227,.7) 0 1px,transparent 1.4px),radial-gradient(circle at 70% 18%,rgba(176,213,206,.55) 0 1px,transparent 1.4px),radial-gradient(circle at 86% 62%,rgba(193,170,136,.55) 0 1px,transparent 1.4px),radial-gradient(circle at 40% 80%,rgba(241,235,227,.5) 0 1px,transparent 1.4px)",
        animation: "amanita-amTwinkle 5s ease-in-out infinite",
      }}
    />
  )
}
