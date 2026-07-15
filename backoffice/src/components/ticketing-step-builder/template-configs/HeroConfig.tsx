import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core"
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  GripVertical,
  Link,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react"
import { useCallback, useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { useFileUpload } from "@/hooks/useFileUpload"
import { cn } from "@/lib/utils"
import type { TemplateConfigProps } from "./types"

// ---------------------------------------------------------------------------
// HeroConfig — editor for the `hero` template (the checkout's opening step).
// Mirrors the schema portal VariantHero + StepperCheckoutFlow's intro bar read.
// Every field is optional: the hero renders whatever is present.
// ---------------------------------------------------------------------------

const IMAGE_FIELDS = [
  {
    key: "logo_url",
    label: "Brand mark",
    description: "Small logo above the wordmark. Optional.",
  },
  {
    key: "date_logo_url",
    label: "Wordmark / date banner",
    description: "The large artwork at the top of the hero.",
  },
  {
    key: "edition_url",
    label: "Edition banner",
    description: "Secondary banner under the wordmark.",
  },
  {
    key: "divider_url",
    label: "Divider ornament",
    description: "Sits above the subtitle.",
  },
  {
    key: "bullet_icon_url",
    label: "Bullet ornament",
    description:
      "Recolored via CSS mask — use a single-color SVG. Tinted by the skin.",
  },
] as const

const TEXT_FIELDS = [
  {
    key: "headline",
    label: "Headline",
    placeholder: "4 días de música, arte, yoga y talleres",
  },
  {
    key: "subtitle",
    label: "Subtitle",
    placeholder: "Una celebración de amor, apertura y conexión",
  },
  {
    key: "date_badge",
    label: "Date badge",
    placeholder: "Experiencia Extendida — 17, 18 y 19 de noviembre",
  },
  {
    key: "cta_hint",
    label: "Bottom bar hint",
    placeholder: "Elegí tu entrada para comenzar",
  },
  { key: "cta_label", label: "Bottom bar CTA", placeholder: "Ver Entradas →" },
] as const

function parseBullets(config: Record<string, unknown> | null): string[] {
  if (!config || !Array.isArray(config.bullets)) return []
  return config.bullets.filter((b): b is string => typeof b === "string")
}

// ---------------------------------------------------------------------------
// Single-value image field (upload or URL)
// ---------------------------------------------------------------------------

function ImageField({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description: string
  value: string
  onChange: (url: string) => void
}) {
  const [mode, setMode] = useState<"upload" | "url">("upload")
  const [urlValue, setUrlValue] = useState("")
  const [dragActive, setDragActive] = useState(false)
  const { uploadFile, uploadProgress, reset, isUploading } = useFileUpload()

  const handleFile = useCallback(
    async (file: File) => {
      try {
        const result = await uploadFile(file)
        onChange(result.publicUrl)
        reset()
      } catch {
        // Surfaced by the hook via uploadProgress.error
      }
    },
    [uploadFile, onChange, reset],
  )

  if (value) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label className="text-sm font-medium">{label}</Label>
        <div className="flex items-center gap-2 rounded-lg border bg-background p-2">
          <div className="h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
            <img src={value} alt="" className="h-full w-full object-contain" />
          </div>
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {value}
          </p>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={`Clear ${label}`}
            onClick={() => onChange("")}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <p className="text-xs text-muted-foreground">{description}</p>

      <div className="flex w-fit gap-1 rounded-lg border p-0.5">
        <button
          type="button"
          onClick={() => setMode("upload")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            mode === "upload"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Upload className="h-3 w-3" />
          Upload
        </button>
        <button
          type="button"
          onClick={() => setMode("url")}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            mode === "url"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Link className="h-3 w-3" />
          URL
        </button>
      </div>

      {mode === "upload" ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop drop zone
        <div
          role="presentation"
          className={cn(
            "rounded-lg border-2 border-dashed p-4 text-center transition-colors",
            dragActive && "border-primary bg-primary/5",
            uploadProgress.status === "error" && "border-destructive",
          )}
          onDragOver={(e) => {
            e.preventDefault()
            setDragActive(true)
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragActive(false)
            if (isUploading) return
            const file = e.dataTransfer.files[0]
            if (file) handleFile(file)
          }}
        >
          {isUploading ? (
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Uploading... {uploadProgress.progress}%
              </p>
            </div>
          ) : uploadProgress.status === "error" ? (
            <div className="flex flex-col items-center gap-2">
              <p className="text-xs text-destructive">{uploadProgress.error}</p>
              <Button type="button" variant="outline" size="sm" onClick={reset}>
                Try Again
              </Button>
            </div>
          ) : (
            <label className="flex cursor-pointer flex-col items-center gap-1.5">
              <Upload className="h-5 w-5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Drag &amp; drop or click to upload
              </p>
              <input
                type="file"
                className="hidden"
                accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) handleFile(file)
                  e.target.value = ""
                }}
              />
            </label>
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <Input
            type="url"
            placeholder="https://example.com/image.webp"
            value={urlValue}
            onChange={(e) => setUrlValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && urlValue.trim()) {
                onChange(urlValue.trim())
                setUrlValue("")
              }
            }}
            className="flex-1"
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!urlValue.trim()}
            onClick={() => {
              onChange(urlValue.trim())
              setUrlValue("")
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            Set
          </Button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sortable bullet row
// ---------------------------------------------------------------------------

function SortableBullet({
  id,
  value,
  onUpdate,
  onDelete,
}: {
  id: string
  value: string
  onUpdate: (value: string) => void
  onDelete: () => void
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
      className="flex items-center gap-2 rounded-lg border bg-background p-2 shadow-sm"
    >
      <button
        type="button"
        aria-label="Reorder bullet"
        className="shrink-0 cursor-grab text-muted-foreground hover:text-foreground"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>
      <Input
        value={value}
        onChange={(e) => onUpdate(e.target.value)}
        placeholder="+200 artistas y facilitadores"
        className="h-7 min-w-0 flex-1 text-xs"
      />
      <Button
        variant="ghost"
        size="icon"
        aria-label="Remove bullet"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={onDelete}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function HeroConfig({ config, onChange }: TemplateConfigProps) {
  const fieldId = useId()
  const bullets = parseBullets(config)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  )

  const setField = (key: string, value: string) => {
    onChange({ ...config, [key]: value })
  }

  const setBullets = (updated: string[]) => {
    onChange({ ...config, bullets: updated })
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = Number(active.id)
    const newIndex = Number(over.id)
    if (Number.isNaN(oldIndex) || Number.isNaN(newIndex)) return
    setBullets(arrayMove(bullets, oldIndex, newIndex))
  }

  return (
    <div className="flex flex-col gap-5">
      {/* Copy */}
      <div className="flex flex-col gap-3">
        {TEXT_FIELDS.map((field) => (
          <div key={field.key} className="flex flex-col gap-1.5">
            <Label
              htmlFor={`${fieldId}-${field.key}`}
              className="text-sm font-medium"
            >
              {field.label}
            </Label>
            <Input
              id={`${fieldId}-${field.key}`}
              value={(config?.[field.key] as string) ?? ""}
              placeholder={field.placeholder}
              onChange={(e) => setField(field.key, e.target.value)}
            />
          </div>
        ))}
      </div>

      <Separator />

      {/* Bullets */}
      <div>
        <Label className="text-sm font-medium">Bullets</Label>
        <p className="mb-3 text-xs text-muted-foreground">
          Short lines under the badge. Drag to reorder.
        </p>
        {bullets.length > 0 && (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={bullets.map((_, i) => String(i))}
              strategy={verticalListSortingStrategy}
            >
              <div className="mb-2 flex flex-col gap-2">
                {bullets.map((bullet, index) => (
                  <SortableBullet
                    key={index}
                    id={String(index)}
                    value={bullet}
                    onUpdate={(value) =>
                      setBullets(
                        bullets.map((b, i) => (i === index ? value : b)),
                      )
                    }
                    onDelete={() =>
                      setBullets(bullets.filter((_, i) => i !== index))
                    }
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setBullets([...bullets, ""])}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add bullet
        </Button>
      </div>

      <Separator />

      {/* Artwork */}
      <div className="flex flex-col gap-4">
        <div>
          <Label className="text-sm font-medium">Artwork</Label>
          <p className="text-xs text-muted-foreground">
            Upload images or paste URLs. Uploads are served from the CDN.
          </p>
        </div>
        {IMAGE_FIELDS.map((field) => (
          <ImageField
            key={field.key}
            label={field.label}
            description={field.description}
            value={(config?.[field.key] as string) ?? ""}
            onChange={(url) => setField(field.key, url)}
          />
        ))}
      </div>
    </div>
  )
}
