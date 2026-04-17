"use client"

import { cn } from "@/lib/utils"

export default function SnapDotNav({
  sections,
  activeSection,
  onDotClick,
}: {
  sections: { id: string; label: string }[]
  activeSection: string
  onDotClick: (index: number) => void
}) {
  return (
    <div className="fixed right-4 top-1/2 -translate-y-1/2 z-50 flex flex-col gap-2">
      {sections.map(({ id, label }, index) => (
        <button
          key={id}
          type="button"
          onClick={() => onDotClick(index)}
          title={label}
          className={cn(
            "w-2 h-2 rounded-full transition-all duration-200",
            activeSection === id
              ? "bg-gray-900 scale-150"
              : "bg-gray-300 hover:bg-gray-500",
          )}
        />
      ))}
    </div>
  )
}
